package com.github.saashybridagent.controlplane;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import reactor.core.publisher.Flux;

@SpringBootTest(
    properties = {
      "saas-hybrid-agent.control-plane.rate-limit.chat-requests-per-window=2",
      "saas-hybrid-agent.control-plane.quota.llm-tokens-limit=100"
    })
@AutoConfigureMockMvc
class ControlPlaneApiTest {

  @Autowired MockMvc mockMvc;

  @Autowired ObjectMapper objectMapper;

  @MockBean ChatModel chatModel;

  private String deviceToken;
  private String deviceId;

  @BeforeEach
  void stubChatModel() {
    ChatResponse response =
        ChatResponse.builder()
            .generations(List.of(new Generation(new AssistantMessage("hello from gateway"))))
            .build();
    when(chatModel.call(any(Prompt.class))).thenReturn(response);
    when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(response));
  }

  @Test
  void deviceRegisterReturnsTokenAndRevokeBlocksProtectedApis() throws Exception {
    JsonNode registered = registerDevice("demo-web", "web");
    deviceId = registered.get("deviceId").asText();
    deviceToken = registered.get("token").asText();
    assertThat(deviceToken).isNotBlank();
    assertThat(registered.get("userId").asText()).isNotBlank();

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + deviceToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("hello from gateway"))
        .andExpect(jsonPath("$.cursor").isNotEmpty());

    mockMvc
        .perform(delete("/v1/devices/" + deviceId).header("Authorization", "Bearer " + deviceToken))
        .andExpect(status().isNoContent());

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + deviceToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("unauthorized"));
  }

  @Test
  void llmChatReturnsToolCallsInJson() throws Exception {
    ChatResponse toolResponse =
        ChatResponse.builder()
            .generations(
                List.of(
                    new Generation(
                        new AssistantMessage(
                            "",
                            Map.of(),
                            List.of(
                                new AssistantMessage.ToolCall(
                                    "call-1", "function", "read_file", "{\"path\":\"/a\"}"))))))
            .build();
    when(chatModel.call(any(Prompt.class))).thenReturn(toolResponse);

    JsonNode registered = registerDevice("tools-web", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "messages":[{"role":"user","content":"read"}],
                      "tools":[{"type":"function","function":{"name":"read_file","parameters":{"type":"object"}}}],
                      "stream":false
                    }
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.finish_reason").value("tool_calls"))
        .andExpect(jsonPath("$.tool_calls[0].function.name").value("read_file"))
        .andExpect(jsonPath("$.tool_calls[0].id").value("call-1"));
  }

  @Test
  void llmChatRequiresAuth() throws Exception {
    mockMvc
        .perform(
            post("/v1/llm/chat")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void llmChatStreamReturnsSse() throws Exception {
    JsonNode registered = registerDevice("stream-web", "web");
    String token = registered.get("token").asText();

    MvcResult mvcResult =
        mockMvc
            .perform(
                post("/v1/llm/chat")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.TEXT_EVENT_STREAM)
                    .content(
                        "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":true}"))
            .andExpect(request().asyncStarted())
            .andReturn();

    mvcResult.getAsyncResult(5000);
    mockMvc
        .perform(asyncDispatch(mvcResult))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM));

    String body = mvcResult.getResponse().getContentAsString();
    assertThat(body).contains("\"type\":\"delta\"");
    assertThat(body).contains("hello from gateway");
    assertThat(body).contains("\"type\":\"done\"");
    assertThat(body).contains("\"cursor\"");
    assertThat(body).contains("id:");
  }

  @Test
  void embeddingsReturnsVectorAndModel() throws Exception {
    JsonNode registered = registerDevice("embed-web", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(
            post("/v1/llm/embeddings")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"input\":\"hello world\",\"model\":\"text-embedding-3-small\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.model").value("text-embedding-3-small"))
        .andExpect(jsonPath("$.data[0].index").value(0))
        .andExpect(jsonPath("$.data[0].embedding").isArray())
        .andExpect(jsonPath("$.data[0].embedding.length()").value(4));
  }

  @Test
  void syncPushPullRoundtripWithCursor() throws Exception {
    JsonNode registered = registerDevice("sync-web", "web");
    String token = registered.get("token").asText();
    String deviceId = registered.get("deviceId").asText();

    String mutation =
        objectMapper.writeValueAsString(
            Map.of(
                "deviceId",
                deviceId,
                "mutations",
                List.of(
                    Map.of(
                        "entityType",
                        "message",
                        "entityId",
                        "msg-1",
                        "version",
                        1,
                        "updatedAt",
                        Instant.parse("2026-07-27T00:00:00Z").toString(),
                        "deviceId",
                        deviceId,
                        "tombstone",
                        false,
                        "payload",
                        Map.of("content", "hello")))));

    mockMvc
        .perform(
            post("/v1/sync/push")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(mutation))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1));

    String pullBody =
        mockMvc
            .perform(get("/v1/sync/pull?since=0").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.mutations.length()").value(1))
            .andExpect(jsonPath("$.mutations[0].entityId").value("msg-1"))
            .andReturn()
            .getResponse()
            .getContentAsString();

    String cursor = objectMapper.readTree(pullBody).get("cursor").asText();
    assertThat(Long.parseLong(cursor)).isGreaterThan(0);

    mockMvc
        .perform(get("/v1/sync/pull?since=" + cursor).header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.mutations.length()").value(0))
        .andExpect(jsonPath("$.cursor").value(cursor));
  }

  @Test
  void quotaEndpointReturnsNumbers() throws Exception {
    JsonNode registered = registerDevice("quota-web", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(
            post("/v1/llm/embeddings")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"input\":\"count me\"}"))
        .andExpect(status().isOk());

    mockMvc
        .perform(get("/v1/quota").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.llmTokensLimit").value(100))
        .andExpect(jsonPath("$.embeddingCallsLimit").value(10000))
        .andExpect(jsonPath("$.embeddingCallsUsed").value(1))
        .andExpect(jsonPath("$.llmTokensUsed").exists());
  }

  @Test
  void chatRateLimitReturns429() throws Exception {
    JsonNode registered = registerDevice("rate-web", "web");
    String token = registered.get("token").asText();
    String body =
        "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}";

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("rate_limited"));
  }

  private JsonNode registerDevice(String name, String platform) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/v1/devices")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"" + name + "\",\"platform\":\"" + platform + "\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.deviceId").isNotEmpty())
            .andExpect(jsonPath("$.token").isNotEmpty())
            .andExpect(jsonPath("$.userId").isNotEmpty())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(body);
  }
}
