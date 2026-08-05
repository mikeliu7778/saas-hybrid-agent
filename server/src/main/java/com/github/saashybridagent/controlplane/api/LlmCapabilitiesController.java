package com.github.saashybridagent.controlplane.api;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.llm.ModelVisionCapabilities;

@RestController
@RequestMapping("/v1/llm")
public class LlmCapabilitiesController {

  @Value("${spring.ai.openai.chat.options.model:gpt-4o-mini}")
  private String defaultModel;

  @GetMapping("/capabilities")
  public Map<String, Object> capabilities(
      @RequestParam(name = "model", required = false) String model,
      @RequestParam(name = "provider", required = false) String provider) {
    String effective = (model == null || model.isBlank()) ? defaultModel : model;
    return Map.of(
        "vision",
        ModelVisionCapabilities.supportsVision(effective),
        "model",
        effective,
        "provider",
        provider == null ? "" : provider);
  }
}
