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
class IngestEventsApiTest {

  @Autowired MockMvc mockMvc;

  @Autowired ObjectMapper objectMapper;

  @MockBean ChatModel chatModel;

  @Test
  void ingestEventsIdempotentAndMetricsBySourceKind() throws Exception {
    JsonNode registered = registerDevice("ingest-web", "web");
    String token = registered.get("token").asText();
    String body =
        """
        {"events":[{"eventId":"ing-1","source":"cursor","kind":"session_summary",
        "ts":"2026-08-06T10:00:00Z","pathCount":2}]}
        """;
    mockMvc
        .perform(
            post("/v1/ingest/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1))
        .andExpect(jsonPath("$.duplicates").value(0));

    mockMvc
        .perform(
            post("/v1/ingest/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(0))
        .andExpect(jsonPath("$.duplicates").value(1));

    mockMvc
        .perform(
            post("/v1/ingest/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[{"eventId":"ing-2","source":"hybrid","kind":"decision",
                    "ts":"2026-08-06T11:00:00Z"}]}
                    """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1));

    mockMvc
        .perform(get("/v1/ingest/metrics?grain=day").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.buckets[0].key").value("2026-08-06"))
        .andExpect(jsonPath("$.buckets[0].total").value(2))
        .andExpect(jsonPath("$.buckets[0].bySource.cursor").value(1))
        .andExpect(jsonPath("$.buckets[0].bySource.hybrid").value(1))
        .andExpect(jsonPath("$.buckets[0].byKind.session_summary").value(1))
        .andExpect(jsonPath("$.buckets[0].byKind.decision").value(1));
  }

  @Test
  void ingestEventsRequiresAuth() throws Exception {
    mockMvc
        .perform(
            post("/v1/ingest/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[{"eventId":"ing-1","source":"cursor","kind":"session_summary",
                    "ts":"2026-08-06T10:00:00Z"}]}
                    """))
        .andExpect(status().isUnauthorized());

    mockMvc.perform(get("/v1/ingest/metrics?grain=day")).andExpect(status().isUnauthorized());
  }

  @Test
  void ingestEventsRejectsInvalidSource() throws Exception {
    JsonNode registered = registerDevice("ingest-bad", "web");
    String token = registered.get("token").asText();
    mockMvc
        .perform(
            post("/v1/ingest/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {"events":[{"eventId":"ing-bad","source":"unknown_tool","kind":"session_summary",
                    "ts":"2026-08-06T10:00:00Z"}]}
                    """))
        .andExpect(status().isBadRequest());
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
