package com.github.saashybridagent.controlplane.dto;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * I3b — analytics-only ingest event (no Memory body / summary text).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record IngestAnalyticsEventDto(
    String eventId,
    String source,
    String kind,
    Instant ts,
    String deviceId,
    String nativeSessionId,
    Integer pathCount) {}
