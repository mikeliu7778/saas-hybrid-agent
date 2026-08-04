package com.github.saashybridagent.controlplane.dto;

import java.util.List;

public record SyncPullResponse(String cursor, List<SyncMutation> mutations) {}
