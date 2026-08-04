package com.github.saashybridagent.controlplane.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record EmbeddingRequest(String model, Object input) {}
