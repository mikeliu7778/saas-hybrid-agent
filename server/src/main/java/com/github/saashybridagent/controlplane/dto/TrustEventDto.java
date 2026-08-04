package com.github.saashybridagent.controlplane.dto;

import java.time.Instant;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TrustEventDto(
    String eventId,
    String deviceId,
    String accountId,
    String sessionId,
    String turnId,
    String kind,
    String target,
    String targetId,
    String signal,
    Double strength,
    Map<String, Object> payload,
    Instant ts) {}
