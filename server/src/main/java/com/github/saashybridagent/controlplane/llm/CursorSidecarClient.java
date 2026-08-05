package com.github.saashybridagent.controlplane.llm;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.saashybridagent.config.SaasHybridAgentProperties;
import com.github.saashybridagent.controlplane.dto.ChatMessageDto;
import com.github.saashybridagent.controlplane.dto.LlmChatRequest;

@Service
public class CursorSidecarClient {

  private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

  private final SaasHybridAgentProperties properties;
  private final ObjectMapper objectMapper;
  private final HttpClient httpClient;

  public CursorSidecarClient(SaasHybridAgentProperties properties, ObjectMapper objectMapper) {
    this.properties = properties;
    this.objectMapper = objectMapper;
    this.httpClient =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .version(HttpClient.Version.HTTP_1_1)
            .build();
  }

  public Map<String, Object> complete(LlmChatRequest request) {
    HttpResponse<String> response = send(request, false, HttpResponse.BodyHandlers.ofString());
    return parseCompleteBody(response);
  }

  public void stream(
      LlmChatRequest request,
      SseEmitter emitter,
      AtomicLong seq,
      EventSender eventSender)
      throws IOException {
    HttpResponse<InputStream> response =
        send(request, true, HttpResponse.BodyHandlers.ofInputStream());
    int status = response.statusCode();
    if (status >= 400) {
      String body;
      try (InputStream in = response.body()) {
        body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      }
      throw mapHttpError(status, body);
    }
    try (BufferedReader reader =
        new BufferedReader(new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (!line.startsWith("data:")) {
          continue;
        }
        String json = line.substring("data:".length()).trim();
        if (json.isEmpty()) {
          continue;
        }
        JsonNode node = objectMapper.readTree(json);
        String type = textOrEmpty(node.get("type"));
        if ("error".equals(type)) {
          throw mapErrorNode(node);
        }
        if ("delta".equals(type)) {
          String text = textOrEmpty(node.get("text"));
          if (!text.isEmpty()) {
            Map<String, Object> delta = new LinkedHashMap<>();
            delta.put("type", "delta");
            delta.put("text", text);
            eventSender.send(emitter, delta, seq);
          }
        } else if ("done".equals(type)) {
          Map<String, Object> done = new LinkedHashMap<>();
          done.put("type", "done");
          done.put("finish_reason", "stop");
          eventSender.send(emitter, done, seq);
        }
        // never emit tool_call from sidecar
      }
    }
  }

  @FunctionalInterface
  public interface EventSender {
    void send(SseEmitter emitter, Map<String, Object> payload, AtomicLong seq) throws IOException;
  }

  private <T> HttpResponse<T> send(
      LlmChatRequest request, boolean stream, HttpResponse.BodyHandler<T> bodyHandler) {
    String base = properties.getLlm().getCursorSidecarUrl();
    if (base == null || base.isBlank()) {
      throw new CursorSidecarException(
          "cursor_sidecar_unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
          "cursor sidecar url is not configured");
    }
    String url = trimTrailingSlash(base) + "/v1/complete";
    try {
      byte[] payload = objectMapper.writeValueAsBytes(toSidecarBody(request, stream));
      HttpRequest httpRequest =
          HttpRequest.newBuilder(URI.create(url))
              .timeout(Duration.ofMinutes(5))
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
              .build();
      return httpClient.send(httpRequest, bodyHandler);
    } catch (CursorSidecarException ex) {
      throw ex;
    } catch (IOException | InterruptedException ex) {
      if (ex instanceof InterruptedException) {
        Thread.currentThread().interrupt();
      }
      throw new CursorSidecarException(
          "cursor_sidecar_unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
          "cursor sidecar unavailable: " + ex.getMessage());
    }
  }

  private Map<String, Object> toSidecarBody(LlmChatRequest request, boolean stream) {
    Map<String, Object> body = new LinkedHashMap<>();
    if (request.model() != null) {
      body.put("model", request.model());
    }
    List<Map<String, Object>> messages = new ArrayList<>();
    if (request.messages() != null) {
      for (ChatMessageDto dto : request.messages()) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("role", dto.role() == null ? "user" : dto.role());
        msg.put(
            "content",
            dto.content() == null || dto.content().isNull()
                ? ""
                : objectMapper.convertValue(dto.content(), Object.class));
        messages.add(msg);
      }
    }
    body.put("messages", messages);
    body.put("stream", stream);
    return body;
  }

  private Map<String, Object> parseCompleteBody(HttpResponse<String> response) {
    int status = response.statusCode();
    String body = response.body() == null ? "" : response.body();
    if (status >= 400) {
      throw mapHttpError(status, body);
    }
    try {
      Map<String, Object> map = objectMapper.readValue(body, MAP_TYPE);
      if (map == null) {
        map = new LinkedHashMap<>();
      }
      Object type = map.get("type");
      if ("error".equals(type)) {
        throw mapErrorMap(map);
      }
      map.putIfAbsent("tool_calls", List.of());
      map.putIfAbsent("finish_reason", "stop");
      map.putIfAbsent("content", "");
      return map;
    } catch (CursorSidecarException ex) {
      throw ex;
    } catch (IOException ex) {
      throw new CursorSidecarException(
          "cursor_run_failed",
          HttpStatus.BAD_GATEWAY,
          "invalid sidecar response: " + ex.getMessage());
    }
  }

  private CursorSidecarException mapHttpError(int status, String body) {
    try {
      JsonNode node = objectMapper.readTree(body);
      if (node != null && node.has("code")) {
        return mapErrorNode(node);
      }
    } catch (IOException ignored) {
      // fall through
    }
    if (status == 503) {
      return new CursorSidecarException(
          "cursor_sidecar_unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
          "cursor sidecar unavailable");
    }
    return new CursorSidecarException(
        "cursor_run_failed", HttpStatus.BAD_GATEWAY, "cursor sidecar HTTP " + status);
  }

  private CursorSidecarException mapErrorNode(JsonNode node) {
    String code = textOrEmpty(node.get("code"));
    String message = textOrEmpty(node.get("message"));
    if (message.isEmpty()) {
      message = code.isEmpty() ? "cursor sidecar error" : code;
    }
    return toTypedException(code, message);
  }

  private CursorSidecarException mapErrorMap(Map<String, Object> map) {
    String code = map.get("code") == null ? "" : String.valueOf(map.get("code"));
    String message = map.get("message") == null ? "" : String.valueOf(map.get("message"));
    if (message.isEmpty()) {
      message = code.isEmpty() ? "cursor sidecar error" : code;
    }
    return toTypedException(code, message);
  }

  private static CursorSidecarException toTypedException(String code, String message) {
    if ("cursor_unauthorized".equals(code)) {
      return new CursorSidecarException(code, HttpStatus.BAD_GATEWAY, message);
    }
    if ("cursor_sidecar_unavailable".equals(code)) {
      return new CursorSidecarException(code, HttpStatus.SERVICE_UNAVAILABLE, message);
    }
    if ("cursor_run_failed".equals(code) || "cursor_error".equals(code)) {
      String normalized = "cursor_error".equals(code) ? "cursor_run_failed" : code;
      return new CursorSidecarException(normalized, HttpStatus.BAD_GATEWAY, message);
    }
    if (code == null || code.isBlank()) {
      return new CursorSidecarException(
          "cursor_run_failed", HttpStatus.BAD_GATEWAY, message);
    }
    return new CursorSidecarException(code, HttpStatus.BAD_GATEWAY, message);
  }

  private static String trimTrailingSlash(String base) {
    if (base.endsWith("/")) {
      return base.substring(0, base.length() - 1);
    }
    return base;
  }

  private static String textOrEmpty(JsonNode node) {
    if (node == null || node.isNull()) {
      return "";
    }
    return node.asText("");
  }
}
