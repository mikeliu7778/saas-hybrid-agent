package com.github.saashybridagent.controlplane.dto;

public record QuotaResponse(
    int llmTokensUsed,
    int llmTokensLimit,
    int embeddingCallsUsed,
    int embeddingCallsLimit) {}
