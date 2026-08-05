package com.github.saashybridagent.controlplane.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.content.Media;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.TextNode;

class LlmGatewayMultimodalMappingTest {

  private final ObjectMapper om = new ObjectMapper();

  @Test
  void buildsUserMessageWithMediaFromDataUri() {
    byte[] pngBytes =
        new byte[] {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
    String tinyPng = Base64.getEncoder().encodeToString(pngBytes);
    ArrayNode parts = om.createArrayNode();
    parts.addObject().put("type", "text").put("text", "what is in this image?");
    parts
        .addObject()
        .put("type", "image_url")
        .putObject("image_url")
        .put("url", "data:image/png;base64," + tinyPng);

    UserMessage msg = MultimodalContent.toUserMessage(parts);

    assertThat(msg.getText()).contains("what");
    assertThat(msg.getMedia()).hasSize(1);
    Media media = msg.getMedia().get(0);
    assertThat(media.getMimeType().toString()).contains("image/png");
    assertThat(media.getDataAsByteArray()).isEqualTo(pngBytes);
  }

  @Test
  void buildsUserMessageWithMediaFromHttpsUrl() {
    ArrayNode parts = om.createArrayNode();
    parts.addObject().put("type", "text").put("text", "describe");
    parts
        .addObject()
        .put("type", "image_url")
        .putObject("image_url")
        .put("url", "https://example.com/cat.png");

    UserMessage msg = MultimodalContent.toUserMessage(parts);

    assertThat(msg.getText()).isEqualTo("describe");
    assertThat(msg.getMedia()).hasSize(1);
    assertThat(msg.getMedia().get(0).getData().toString()).contains("https://example.com/cat.png");
  }

  @Test
  void textualContentBecomesPlainUserMessage() {
    UserMessage msg = MultimodalContent.toUserMessage(TextNode.valueOf("hello"));
    assertThat(msg.getText()).isEqualTo("hello");
    assertThat(msg.getMedia()).isEmpty();
  }
}
