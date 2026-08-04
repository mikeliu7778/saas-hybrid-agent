package com.github.saashybridagent.controlplane.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SyncMutation(
    String entityType,
    String entityId,
    long version,
    Instant updatedAt,
    String deviceId,
    Boolean tombstone,
    Map<String, Object> payload,
    List<Double> embedding,
    String embeddingModelId) {}
