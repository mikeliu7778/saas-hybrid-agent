package com.github.saashybridagent.controlplane.dto;

import java.util.List;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

public record SyncPushRequest(@NotNull String deviceId, @NotEmpty List<SyncMutation> mutations) {}
