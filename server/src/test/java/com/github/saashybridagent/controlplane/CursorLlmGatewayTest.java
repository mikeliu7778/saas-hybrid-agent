package com.github.saashybridagent.controlplane;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.saashybridagent.config.SaasHybridAgentProperties;
import com.sun.net.httpserver.HttpServer;

@SpringBootTest(
    properties = {
      "saas-hybrid-agent.control-plane.rate-limit.chat-requests-per-window=100",
      "saas-hybrid-agent.control-plane.quota.llm-tokens-limit=100000"
    })
@AutoConfigureMockMvc
class CursorLlmGatewayTest {

  private static final HttpServer sidecar;
  private static final int sidecarPort;
  private static final AtomicReference<String> lastRequestBody = new AtomicReference<>();
  private static volatile Mode mode = Mode.JSON_OK;

  private enum Mode {
    JSON_OK,
    SSE_OK,
    JSON_UNAUTHORIZED,
    JSON_RUN_FAILED
  }

  static {
    try {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      server.createContext(
          "/v1/complete",
          exchange -> {
            byte[] req = exchange.getRequestBody().readAllBytes();
            lastRequestBody.set(new String(req, StandardCharsets.UTF_8));
            switch (mode) {
              case JSON_OK -> {
                byte[] body =
                    "{\"content\":\"from-cursor\",\"tool_calls\":[],\"finish_reason\":\"stop\"}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                  os.write(body);
                }
              }
              case SSE_OK -> {
                String sse =
                    "data: {\"type\":\"delta\",\"text\":\"hello\"}\n\n"
                        + "data: {\"type\":\"delta\",\"text\":\" cursor\"}\n\n"
                        + "data: {\"type\":\"done\"}\n\n";
                byte[] body = sse.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                  os.write(body);
                }
              }
              case JSON_UNAUTHORIZED -> {
                byte[] body =
                    "{\"type\":\"error\",\"code\":\"cursor_unauthorized\",\"message\":\"no key\"}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(502, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                  os.write(body);
                }
              }
              case JSON_RUN_FAILED -> {
                byte[] body =
                    "{\"type\":\"error\",\"code\":\"cursor_run_failed\",\"message\":\"run failed\"}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(502, body.length);
                try (OutputStream os = exchange.getResponseBody()) {
                  os.write(body);
                }
              }
            }
          });
      server.start();
      sidecar = server;
      sidecarPort = server.getAddress().getPort();
    } catch (IOException ex) {
      throw new ExceptionInInitializerError(ex);
    }
  }

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired SaasHybridAgentProperties properties;

  @MockBean ChatModel chatModel;

  private String savedSidecarUrl;

  @AfterAll
  static void stopSidecar() {
    if (sidecar != null) {
      sidecar.stop(0);
    }
  }

  @DynamicPropertySource
  static void registerSidecarUrl(DynamicPropertyRegistry registry) {
    registry.add(
        "saas-hybrid-agent.llm.cursor-sidecar-url",
        () -> "http://127.0.0.1:" + sidecarPort);
  }

  @BeforeEach
  void reset() {
    mode = Mode.JSON_OK;
    lastRequestBody.set(null);
    savedSidecarUrl = properties.getLlm().getCursorSidecarUrl();
    properties.getLlm().setCursorSidecarUrl("http://127.0.0.1:" + sidecarPort);
  }

  @AfterEach
  void restoreUrl() {
    properties.getLlm().setCursorSidecarUrl(savedSidecarUrl);
  }

  @Test
  void cursorProviderNonStreamUsesSidecarNotChatModel() throws Exception {
    mode = Mode.JSON_OK;
    JsonNode registered = registerDevice("cursor-json", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "provider":"cursor",
                      "messages":[{"role":"user","content":"hi"}],
                      "tools":[{"type":"function","function":{"name":"read_file"}}],
                      "stream":false
                    }
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("from-cursor"))
        .andExpect(jsonPath("$.tool_calls").isArray())
        .andExpect(jsonPath("$.finish_reason").value("stop"))
        .andExpect(jsonPath("$.cursor").isNotEmpty());

    verify(chatModel, never()).call(any(Prompt.class));
    verify(chatModel, never()).stream(any(Prompt.class));

    String sidecarBody = lastRequestBody.get();
    assertThat(sidecarBody).isNotBlank();
    assertThat(sidecarBody).doesNotContain("\"tools\"");
    assertThat(sidecarBody).contains("\"stream\":false");
    assertThat(sidecarBody).contains("\"role\":\"user\"");
  }

  @Test
  void cursorSidecarDownReturns503() throws Exception {
    properties.getLlm().setCursorSidecarUrl("http://127.0.0.1:1");
    JsonNode registered = registerDevice("cursor-down", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "provider":"cursor",
                      "messages":[{"role":"user","content":"hi"}],
                      "stream":false
                    }
                    """))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("cursor_sidecar_unavailable"));

    verify(chatModel, never()).call(any(Prompt.class));
  }

  @Test
  void cursorUnauthorizedMapsTo502() throws Exception {
    mode = Mode.JSON_UNAUTHORIZED;
    JsonNode registered = registerDevice("cursor-unauth", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "provider":"cursor",
                      "messages":[{"role":"user","content":"hi"}],
                      "stream":false
                    }
                    """))
        .andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.code").value("cursor_unauthorized"));
  }

  @Test
  void cursorProviderStreamMapsDeltaAndDone() throws Exception {
    mode = Mode.SSE_OK;
    JsonNode registered = registerDevice("cursor-sse", "web");
    String token = registered.get("token").asText();

    MvcResult mvcResult =
        mockMvc
            .perform(
                post("/v1/llm/chat")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.TEXT_EVENT_STREAM)
                    .content(
                        """
                        {
                          "provider":"cursor",
                          "messages":[{"role":"user","content":"hi"}],
                          "stream":true
                        }
                        """))
            .andExpect(request().asyncStarted())
            .andReturn();

    mvcResult.getAsyncResult(5000);
    mockMvc
        .perform(asyncDispatch(mvcResult))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM));

    String body = mvcResult.getResponse().getContentAsString();
    assertThat(body).contains("\"type\":\"delta\"");
    assertThat(body).contains("hello");
    assertThat(body).contains("cursor");
    assertThat(body).contains("\"type\":\"done\"");
    assertThat(body).doesNotContain("\"type\":\"tool_call\"");
    verify(chatModel, never()).stream(any(Prompt.class));
  }

  private JsonNode registerDevice(String name, String platform) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/v1/devices")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"" + name + "\",\"platform\":\"" + platform + "\"}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(body);
  }
}
