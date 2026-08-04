package com.github.saashybridagent.controlplane.api;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.dto.EmbeddingRequest;
import com.github.saashybridagent.controlplane.dto.EmbeddingResponse;
import com.github.saashybridagent.controlplane.llm.EmbeddingGatewayService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1/llm")
public class EmbeddingController {

  private final EmbeddingGatewayService embeddingGatewayService;

  public EmbeddingController(EmbeddingGatewayService embeddingGatewayService) {
    this.embeddingGatewayService = embeddingGatewayService;
  }

  @PostMapping("/embeddings")
  public EmbeddingResponse embeddings(
      @Valid @RequestBody EmbeddingRequest request,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return embeddingGatewayService.embed(request, userId);
  }
}
