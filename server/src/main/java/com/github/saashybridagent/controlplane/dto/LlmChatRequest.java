package com.github.saashybridagent.controlplane.dto;

import java.util.List;
import java.util.Map;

import jakarta.validation.constraints.NotEmpty;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record LlmChatRequest(
    String model,
    String provider,
    @NotEmpty List<ChatMessageDto> messages,
    List<Map<String, Object>> tools,
    Boolean stream,
    /** Optional SSE Last-Event-ID / resume cursor from a prior event. */
    String cursor) {}
