package com.github.saashybridagent.controlplane.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.github.saashybridagent.controlplane.dto.ChatMessageDto;

class MultimodalContentTest {

  private final ObjectMapper om = new ObjectMapper();

  private ArrayNode pngParts() {
    ArrayNode parts = om.createArrayNode();
    parts.addObject().put("type", "text").put("text", "see");
    parts
        .addObject()
        .put("type", "image_url")
        .putObject("image_url")
        .put("url", "data:image/png;base64,aaaa");
    return parts;
  }

  @Test
  void rejectsImagesWhenModelLacksVision() {
    ChatMessageDto msg = new ChatMessageDto("user", pngParts(), null, null, null);
    assertThatThrownBy(() -> MultimodalContent.validate(List.of(msg), "gpt-3.5-turbo"))
        .isInstanceOf(MultimodalValidationException.class)
        .extracting(ex -> ((MultimodalValidationException) ex).getCode())
        .isEqualTo("model_lacks_vision");
  }

  @Test
  void acceptsVisionModelWithPngDataUri() {
    ChatMessageDto msg = new ChatMessageDto("user", pngParts(), null, null, null);
    MultimodalContent.validate(List.of(msg), "gpt-4o-mini");
  }

  @Test
  void stringContentStillPlainText() {
    assertThat(MultimodalContent.asPlainText(om.getNodeFactory().textNode("hi"))).isEqualTo("hi");
  }

  @Test
  void rejectsImageOnAssistantRole() {
    ChatMessageDto msg = new ChatMessageDto("assistant", pngParts(), null, null, null);
    assertThatThrownBy(() -> MultimodalContent.validate(List.of(msg), "gpt-4o-mini"))
        .isInstanceOf(MultimodalValidationException.class)
        .extracting(ex -> ((MultimodalValidationException) ex).getCode())
        .isEqualTo("image_role_invalid");
  }

  @Test
  void rejectsSixImages() {
    List<ChatMessageDto> messages = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      ArrayNode parts = om.createArrayNode();
      parts
          .addObject()
          .put("type", "image_url")
          .putObject("image_url")
          .put("url", "data:image/png;base64,aaaa");
      messages.add(new ChatMessageDto("user", parts, null, null, null));
    }
    assertThatThrownBy(() -> MultimodalContent.validate(messages, "gpt-4o-mini"))
        .isInstanceOf(MultimodalValidationException.class)
        .extracting(ex -> ((MultimodalValidationException) ex).getCode())
        .isEqualTo("image_limit");
  }

  @Test
  void rejectsUnsupportedSvgMime() {
    ArrayNode parts = om.createArrayNode();
    parts
        .addObject()
        .put("type", "image_url")
        .putObject("image_url")
        .put("url", "data:image/svg+xml;base64,aaaa");
    ChatMessageDto msg = new ChatMessageDto("user", parts, null, null, null);
    assertThatThrownBy(() -> MultimodalContent.validate(List.of(msg), "gpt-4o-mini"))
        .isInstanceOf(MultimodalValidationException.class)
        .extracting(ex -> ((MultimodalValidationException) ex).getCode())
        .isEqualTo("image_unsupported");
  }

  @Test
  void rejectsImageOverFourMegabytes() {
    byte[] oversized = new byte[4 * 1024 * 1024 + 1];
    String b64 = Base64.getEncoder().encodeToString(oversized);
    ArrayNode parts = om.createArrayNode();
    parts
        .addObject()
        .put("type", "image_url")
        .putObject("image_url")
        .put("url", "data:image/png;base64," + b64);
    ChatMessageDto msg = new ChatMessageDto("user", parts, null, null, null);
    assertThatThrownBy(() -> MultimodalContent.validate(List.of(msg), "gpt-4o-mini"))
        .isInstanceOf(MultimodalValidationException.class)
        .extracting(ex -> ((MultimodalValidationException) ex).getCode())
        .isEqualTo("image_limit");
  }
}
