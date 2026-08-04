package com.github.saashybridagent.controlplane.dto;

import java.util.List;

public record EmbeddingResponse(String model, List<EmbeddingData> data) {

  public record EmbeddingData(List<Double> embedding, int index) {}
}
