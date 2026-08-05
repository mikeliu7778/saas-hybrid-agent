package com.github.saashybridagent.controlplane;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

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

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import reactor.core.publisher.Flux;

@SpringBootTest
@AutoConfigureMockMvc
class MultimodalLlmGatewayTest {

  @Autowired MockMvc mockMvc;

  @Autowired ObjectMapper objectMapper;

  @MockBean ChatModel chatModel;

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
  void chatWithImageAndNonVisionModelReturns400() throws Exception {
    String token = registerAndGetToken();
    String body =
        """
        {
          "model": "gpt-3.5-turbo",
          "stream": false,
          "messages": [{
            "role": "user",
            "content": [
              {"type":"text","text":"what"},
              {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}
            ]
          }]
        }
        """;
    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("model_lacks_vision"));
  }

  @Test
  void plainStringContentStillAcceptedShape() throws Exception {
    String token = registerAndGetToken();
    mockMvc
        .perform(
            post("/v1/llm/chat")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content").value("hello from gateway"));
  }

  @Test
  void capabilitiesEndpoint() throws Exception {
    String token = registerAndGetToken();
    mockMvc
        .perform(
            get("/v1/llm/capabilities")
                .param("model", "gpt-4o-mini")
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.vision").value(true))
        .andExpect(jsonPath("$.model").value("gpt-4o-mini"));
    mockMvc
        .perform(
            get("/v1/llm/capabilities")
                .param("model", "gpt-3.5-turbo")
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.vision").value(false))
        .andExpect(jsonPath("$.model").value("gpt-3.5-turbo"));
  }

  private String registerAndGetToken() throws Exception {
    String body =
        mockMvc
            .perform(
                post("/v1/devices")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"name\":\"vision-web\",\"platform\":\"web\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.token").isNotEmpty())
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode registered = objectMapper.readTree(body);
    return registered.get("token").asText();
  }
}
