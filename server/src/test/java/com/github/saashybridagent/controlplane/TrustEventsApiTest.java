package com.github.saashybridagent.controlplane;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.ai.chat.model.ChatModel;

@SpringBootTest
@AutoConfigureMockMvc
class TrustEventsApiTest {

  @Autowired MockMvc mockMvc;

  @Autowired ObjectMapper objectMapper;

  @MockBean ChatModel chatModel;

  @Test
  void trustEventsIdempotentAndMetricsAggregate() throws Exception {
    JsonNode registered = registerDevice("trust-web", "web");
    String token = registered.get("token").asText();
    String body =
        """
        {"events":[{"eventId":"e-1","kind":"explicit_message_feedback","target":"assistant_message",
        "targetId":"m1","signal":"trust","strength":0.9,"ts":"2026-08-04T10:00:00Z"}]}
        """;
    mockMvc
        .perform(
            post("/v1/trust/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1))
        .andExpect(jsonPath("$.duplicates").value(0));

    mockMvc
        .perform(
            post("/v1/trust/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(0))
        .andExpect(jsonPath("$.duplicates").value(1));

    mockMvc
        .perform(get("/v1/trust/metrics?grain=day").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.buckets[0].key").value("2026-08-04"))
        .andExpect(jsonPath("$.buckets[0].trust").value(1))
        .andExpect(jsonPath("$.buckets[0].distrust").value(0))
        .andExpect(jsonPath("$.buckets[0].correct").value(0))
        .andExpect(jsonPath("$.buckets[0].byKind.explicit_message_feedback").value(1));
  }

  @Test
  void trustEventsRequiresAuth() throws Exception {
    mockMvc
        .perform(
            post("/v1/trust/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[{"eventId":"e-1","kind":"explicit_message_feedback","target":"assistant_message",
                    "targetId":"m1","signal":"trust","ts":"2026-08-04T10:00:00Z"}]}
                    """))
        .andExpect(status().isUnauthorized());

    mockMvc.perform(get("/v1/trust/metrics?grain=day")).andExpect(status().isUnauthorized());
  }

  @Test
  void trustEventsRejectsInvalidBatchWith400() throws Exception {
    JsonNode registered = registerDevice("trust-bad", "web");
    String token = registered.get("token").asText();

    // Missing required field (eventId) → reject whole batch
    mockMvc
        .perform(
            post("/v1/trust/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[
                      {"eventId":"ok-1","kind":"explicit_message_feedback","target":"assistant_message",
                       "targetId":"m1","signal":"trust","ts":"2026-08-04T10:00:00Z"},
                      {"kind":"explicit_message_feedback","target":"assistant_message",
                       "targetId":"m2","signal":"trust","ts":"2026-08-04T11:00:00Z"}
                    ]}
                    """))
        .andExpect(status().isBadRequest());

    // Invalid signal → 400
    mockMvc
        .perform(
            post("/v1/trust/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[{"eventId":"e-bad","kind":"explicit_message_feedback","target":"assistant_message",
                    "targetId":"m1","signal":"maybe","ts":"2026-08-04T10:00:00Z"}]}
                    """))
        .andExpect(status().isBadRequest());

    // Nothing accepted after rejected batches
    mockMvc
        .perform(get("/v1/trust/metrics?grain=day").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.buckets").isEmpty());
  }

  @Test
  void trustMetricsEmptyBucketsWhenNoEvents() throws Exception {
    JsonNode registered = registerDevice("trust-empty", "web");
    String token = registered.get("token").asText();

    mockMvc
        .perform(get("/v1/trust/metrics?grain=day").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.buckets").isArray())
        .andExpect(jsonPath("$.buckets").isEmpty());
  }

  @Test
  void trustMetricsScopedPerUser() throws Exception {
    JsonNode userA = registerDevice("trust-user-a", "web");
    JsonNode userB = registerDevice("trust-user-b", "web");
    String tokenA = userA.get("token").asText();
    String tokenB = userB.get("token").asText();

    mockMvc
        .perform(
            post("/v1/trust/events")
                .header("Authorization", "Bearer " + tokenA)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[{"eventId":"a-1","kind":"implicit_followup","target":"assistant_message",
                    "targetId":"m1","signal":"distrust","ts":"2026-08-04T10:00:00Z"}]}
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1));

    mockMvc
        .perform(get("/v1/trust/metrics?grain=day").header("Authorization", "Bearer " + tokenB))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.buckets").isEmpty());

    mockMvc
        .perform(get("/v1/trust/metrics?grain=day").header("Authorization", "Bearer " + tokenA))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.buckets[0].distrust").value(1));
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
