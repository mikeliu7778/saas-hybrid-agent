package com.github.saashybridagent.controlplane.llm;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ModelVisionCapabilitiesTest {

  @Test
  void knownVisionModels() {
    assertThat(ModelVisionCapabilities.supportsVision("gpt-4o-mini")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("GPT-4.1")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("gpt-4-turbo")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("gpt-5")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("composer-2.5")).isTrue();
    assertThat(ModelVisionCapabilities.supportsVision("cursor-small")).isTrue();
  }

  @Test
  void unknownAndBlankAreFalse() {
    assertThat(ModelVisionCapabilities.supportsVision("gpt-3.5-turbo")).isFalse();
    assertThat(ModelVisionCapabilities.supportsVision("o1-preview")).isFalse();
    assertThat(ModelVisionCapabilities.supportsVision("")).isFalse();
    assertThat(ModelVisionCapabilities.supportsVision(null)).isFalse();
  }
}
