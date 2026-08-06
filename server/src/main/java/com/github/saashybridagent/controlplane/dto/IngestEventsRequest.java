package com.github.saashybridagent.controlplane.dto;

import java.util.List;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

public record IngestEventsRequest(@NotNull @NotEmpty List<IngestAnalyticsEventDto> events) {}
