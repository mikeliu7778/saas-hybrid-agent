package com.github.saashybridagent.controlplane.dto;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ChatMessageDto(
    String role,
    String content,
    @JsonProperty("tool_calls") List<Map<String, Object>> toolCalls,
    @JsonProperty("tool_call_id") String toolCallId,
    String name) {}
