package com.github.saashybridagent.controlplane.llm;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.DefaultToolDefinition;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.saashybridagent.controlplane.dto.ChatMessageDto;
import com.github.saashybridagent.controlplane.dto.LlmChatRequest;
import com.github.saashybridagent.controlplane.quota.QuotaService;

import reactor.core.publisher.Flux;

@Service
public class LlmGatewayService {

  private final ChatModel chatModel;
  private final QuotaService quotaService;
  private final RateLimiter rateLimiter;
  private final ObjectMapper objectMapper;
  private final AtomicLong globalCursor = new AtomicLong(0);

  public LlmGatewayService(
      ChatModel chatModel,
      QuotaService quotaService,
      RateLimiter rateLimiter,
      ObjectMapper objectMapper) {
    this.chatModel = chatModel;
    this.quotaService = quotaService;
    this.rateLimiter = rateLimiter;
    this.objectMapper = objectMapper;
  }

  public Map<String, Object> complete(LlmChatRequest request, String userId) {
    ensureAllowed(userId);
    ChatResponse response = chatModel.call(toPrompt(request));
    quotaService.recordLlmTokens(userId, extractTokens(response));
    Map<String, Object> body = toJsonResponse(response);
    body.put("cursor", nextCursor(request.cursor()));
    return body;
  }

  public SseEmitter stream(LlmChatRequest request, String userId) {
    ensureAllowed(userId);
    SseEmitter emitter = new SseEmitter(0L);
    AtomicLong seq = new AtomicLong(parseCursor(request.cursor()));
    Flux<ChatResponse> flux = chatModel.stream(toPrompt(request));
    flux.subscribe(
        chunk -> {
          try {
            emitChunk(emitter, chunk, seq);
          } catch (IOException ex) {
            emitter.completeWithError(ex);
          }
        },
        emitter::completeWithError,
        () -> {
          try {
            quotaService.recordLlmTokens(userId, 1);
            Map<String, Object> done = new LinkedHashMap<>();
            done.put("type", "done");
            done.put("finish_reason", "stop");
            sendEvent(emitter, done, seq);
            emitter.complete();
          } catch (IOException ex) {
            emitter.completeWithError(ex);
          }
        });
    return emitter;
  }

  public void ensureAllowed(String userId) {
    if (!rateLimiter.tryAcquireChat(userId)) {
      throw new RateLimitExceededException("Chat rate limit exceeded");
    }
    if (quotaService.isLlmOverLimit(userId)) {
      throw new RateLimitExceededException("LLM token quota exceeded");
    }
  }

  private void emitChunk(SseEmitter emitter, ChatResponse chunk, AtomicLong seq) throws IOException {
    Generation generation = chunk.getResult();
    if (generation == null || generation.getOutput() == null) {
      return;
    }
    AssistantMessage output = generation.getOutput();
    String text = output.getText();
    if (text != null && !text.isEmpty()) {
      Map<String, Object> delta = new LinkedHashMap<>();
      delta.put("type", "delta");
      delta.put("text", text);
      sendEvent(emitter, delta, seq);
    }
    if (output.hasToolCalls()) {
      for (AssistantMessage.ToolCall toolCall : output.getToolCalls()) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", "tool_call");
        event.put("id", toolCall.id());
        event.put("name", toolCall.name());
        event.put("arguments", toolCall.arguments());
        sendEvent(emitter, event, seq);
      }
    }
  }

  private void sendEvent(SseEmitter emitter, Map<String, Object> payload, AtomicLong seq)
      throws IOException {
    String cursor = Long.toString(seq.incrementAndGet());
    Map<String, Object> body = new LinkedHashMap<>(payload);
    body.put("cursor", cursor);
    emitter.send(SseEmitter.event().id(cursor).data(body, MediaType.APPLICATION_JSON));
  }

  private String nextCursor(String since) {
    long base = parseCursor(since);
    long next = Math.max(globalCursor.incrementAndGet(), base + 1);
    globalCursor.updateAndGet(cur -> Math.max(cur, next));
    return Long.toString(next);
  }

  private static long parseCursor(String cursor) {
    if (cursor == null || cursor.isBlank()) {
      return 0L;
    }
    try {
      return Long.parseLong(cursor.trim());
    } catch (NumberFormatException ex) {
      return 0L;
    }
  }

  private Prompt toPrompt(LlmChatRequest request) {
    List<Message> messages = new ArrayList<>();
    if (request.messages() != null) {
      for (ChatMessageDto dto : request.messages()) {
        messages.add(toSpringMessage(dto));
      }
    }
    List<Map<String, Object>> tools = request.tools();
    if (tools == null || tools.isEmpty()) {
      if (request.model() != null) {
        return new Prompt(
            messages, ToolCallingChatOptions.builder().model(request.model()).build());
      }
      return new Prompt(messages);
    }
    ToolCallingChatOptions.Builder builder =
        ToolCallingChatOptions.builder()
            .toolCallbacks(toCallbacks(tools))
            .internalToolExecutionEnabled(false);
    if (request.model() != null) {
      builder.model(request.model());
    }
    return new Prompt(messages, builder.build());
  }

  private List<ToolCallback> toCallbacks(List<Map<String, Object>> tools) {
    List<ToolCallback> callbacks = new ArrayList<>();
    for (Map<String, Object> tool : tools) {
      @SuppressWarnings("unchecked")
      Map<String, Object> function =
          tool.get("function") instanceof Map<?, ?> m
              ? (Map<String, Object>) m
              : Map.of();
      String name = String.valueOf(function.getOrDefault("name", "unknown"));
      String description = String.valueOf(function.getOrDefault("description", ""));
      String schema = "{}";
      Object parameters = function.get("parameters");
      if (parameters != null) {
        try {
          schema = objectMapper.writeValueAsString(parameters);
        } catch (JsonProcessingException ignored) {
          schema = "{}";
        }
      }
      org.springframework.ai.tool.definition.ToolDefinition definition =
          DefaultToolDefinition.builder()
              .name(name)
              .description(description)
              .inputSchema(schema)
              .build();
      callbacks.add(
          new ToolCallback() {
            @Override
            public org.springframework.ai.tool.definition.ToolDefinition getToolDefinition() {
              return definition;
            }

            @Override
            public String call(String toolInput) {
              throw new UnsupportedOperationException(
                  "Tool execution is handled by client ConversationLoop, not ChatModel");
            }
          });
    }
    return callbacks;
  }

  private Message toSpringMessage(ChatMessageDto dto) {
    String role = dto.role() == null ? "user" : dto.role();
    return switch (role) {
      case "system" -> new SystemMessage(dto.content() == null ? "" : dto.content());
      case "assistant" -> toAssistant(dto);
      case "tool" ->
          new ToolResponseMessage(
              List.of(
                  new ToolResponseMessage.ToolResponse(
                      dto.toolCallId() == null ? "" : dto.toolCallId(),
                      dto.name() == null ? "" : dto.name(),
                      dto.content() == null ? "" : dto.content())));
      default -> new UserMessage(dto.content() == null ? "" : dto.content());
    };
  }

  private static AssistantMessage toAssistant(ChatMessageDto dto) {
    List<AssistantMessage.ToolCall> toolCalls = new ArrayList<>();
    if (dto.toolCalls() != null) {
      for (Map<String, Object> tc : dto.toolCalls()) {
        String id = String.valueOf(tc.getOrDefault("id", ""));
        @SuppressWarnings("unchecked")
        Map<String, Object> fn =
            tc.get("function") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        String name = String.valueOf(fn.getOrDefault("name", ""));
        String arguments = String.valueOf(fn.getOrDefault("arguments", "{}"));
        toolCalls.add(new AssistantMessage.ToolCall(id, "function", name, arguments));
      }
    }
    return new AssistantMessage(dto.content() == null ? "" : dto.content(), Map.of(), toolCalls);
  }

  private static Map<String, Object> toJsonResponse(ChatResponse response) {
    Map<String, Object> body = new LinkedHashMap<>();
    String content = "";
    List<Map<String, Object>> toolCalls = new ArrayList<>();
    String finishReason = "stop";
    if (response != null && response.getResult() != null && response.getResult().getOutput() != null) {
      AssistantMessage output = response.getResult().getOutput();
      content = nullToEmpty(output.getText());
      if (output.hasToolCalls()) {
        finishReason = "tool_calls";
        for (AssistantMessage.ToolCall tc : output.getToolCalls()) {
          Map<String, Object> call = new LinkedHashMap<>();
          call.put("id", tc.id());
          call.put("type", "function");
          call.put(
              "function",
              Map.of(
                  "name", tc.name(),
                  "arguments", tc.arguments() == null ? "{}" : tc.arguments()));
          toolCalls.add(call);
        }
      }
    }
    body.put("content", content.isEmpty() && !toolCalls.isEmpty() ? null : content);
    body.put("tool_calls", toolCalls);
    body.put("finish_reason", finishReason);
    body.put("usage", Map.of("tokens", extractTokens(response)));
    return body;
  }

  private static int extractTokens(ChatResponse response) {
    if (response == null || response.getMetadata() == null || response.getMetadata().getUsage() == null) {
      return 1;
    }
    Usage usage = response.getMetadata().getUsage();
    int input = usage.getPromptTokens() == null ? 0 : usage.getPromptTokens();
    int output = usage.getCompletionTokens() == null ? 0 : usage.getCompletionTokens();
    return Math.max(1, input + output);
  }

  private static String nullToEmpty(String value) {
    return value == null ? "" : value;
  }

  public static class RateLimitExceededException extends RuntimeException {
    public RateLimitExceededException(String message) {
      super(message);
    }
  }
}
