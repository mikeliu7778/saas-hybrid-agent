package com.github.saashybridagent.controlplane.llm;

public final class ModelVisionCapabilities {
  private ModelVisionCapabilities() {}

  public static boolean supportsVision(String modelId) {
    if (modelId == null || modelId.isBlank()) {
      return false;
    }
    String m = modelId.trim().toLowerCase();
    return m.startsWith("gpt-4o")
        || m.startsWith("gpt-4.1")
        || m.startsWith("gpt-4-turbo")
        || m.startsWith("gpt-5")
        || m.startsWith("composer-")
        || m.startsWith("cursor-");
  }
}
