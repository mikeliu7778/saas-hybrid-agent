package com.github.saashybridagent.controlplane.dto;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class LlmChatRequestTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void deserializesProviderField() throws Exception {
    LlmChatRequest request =
        objectMapper.readValue(
            "{\"messages\":[{\"role\":\"user\",\"content\":\"x\"}],\"provider\":\"cursor\"}",
            LlmChatRequest.class);

    assertThat(request.provider()).isEqualTo("cursor");
  }
}
