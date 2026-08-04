package com.github.saashybridagent.controlplane.api;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.dto.LlmChatRequest;
import com.github.saashybridagent.controlplane.llm.LlmGatewayService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1/llm")
public class LlmGatewayController {

  private final LlmGatewayService llmGatewayService;

  public LlmGatewayController(LlmGatewayService llmGatewayService) {
    this.llmGatewayService = llmGatewayService;
  }

  @PostMapping(
      path = "/chat",
      produces = {MediaType.APPLICATION_JSON_VALUE, MediaType.TEXT_EVENT_STREAM_VALUE})
  public Object chat(
      @Valid @RequestBody LlmChatRequest request,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    boolean stream = request.stream() == null || Boolean.TRUE.equals(request.stream());
    if (stream) {
      return llmGatewayService.stream(request, userId);
    }
    return llmGatewayService.complete(request, userId);
  }
}
