package com.github.saashybridagent.controlplane.llm;

import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.content.Media;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.util.MimeTypeUtils;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.github.saashybridagent.controlplane.dto.ChatMessageDto;

/**
 * Multimodal content helpers for chat messages.
 *
 * <p>Phase 1 accepts only {@code data:} image URIs. {@code http(s)://} URL shape is reserved in the
 * protocol but rejected with {@code image_unsupported}. When a request carries more than {@link
 * #MAX_IMAGES} image parts (e.g. historical re-send), oldest {@code image_url} parts are dropped in
 * place so accumulation alone does not 400 — aligned with the Cursor sidecar keep-newest behavior.
 */
public final class MultimodalContent {
  public static final int MAX_IMAGES = 5;
  public static final int MAX_BYTES = 4 * 1024 * 1024;
  public static final Set<String> ALLOWED_MIME =
      Set.of("image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp");

  private static final Pattern DATA_URI =
      Pattern.compile("^data:(image/(png|jpeg|jpg|gif|webp));base64,(.+)$");

  private MultimodalContent() {}

  public static int countImages(List<ChatMessageDto> messages) {
    int count = 0;
    if (messages == null) {
      return 0;
    }
    for (ChatMessageDto msg : messages) {
      count += countImagesInContent(msg == null ? null : msg.content());
    }
    return count;
  }

  /**
   * Drops oldest {@code image_url} parts until ≤ {@link #MAX_IMAGES}, then validates remaining
   * images (role / MIME / size / data-URI-only). Mutates message content arrays in place when
   * truncation is needed so the outbound request matches what was accepted.
   */
  public static void validate(List<ChatMessageDto> messages, String effectiveModel) {
    dropOldestImagesBeyondLimit(messages);
    int imageCount = 0;
    if (messages != null) {
      for (ChatMessageDto msg : messages) {
        if (msg == null) {
          continue;
        }
        JsonNode content = msg.content();
        if (content == null || !content.isArray()) {
          continue;
        }
        for (JsonNode part : content) {
          if (part == null || !part.isObject()) {
            continue;
          }
          if (!"image_url".equals(textOrNull(part.get("type")))) {
            continue;
          }
          String role = msg.role() == null ? "" : msg.role();
          if (!"user".equals(role)) {
            throw new MultimodalValidationException(
                "image_role_invalid", "image_url parts are only allowed on user messages");
          }
          JsonNode imageUrl = part.get("image_url");
          String url =
              imageUrl != null && imageUrl.isObject() ? textOrNull(imageUrl.get("url")) : null;
          validateImageUrl(url);
          imageCount++;
        }
      }
    }
    if (imageCount > 0 && !ModelVisionCapabilities.supportsVision(effectiveModel)) {
      throw new MultimodalValidationException(
          "model_lacks_vision", "model does not support vision: " + effectiveModel);
    }
  }

  public static String asPlainText(JsonNode content) {
    if (content == null || content.isNull()) {
      return "";
    }
    if (content.isTextual()) {
      return content.asText();
    }
    if (content.isArray()) {
      StringBuilder sb = new StringBuilder();
      for (JsonNode part : content) {
        if (part != null && part.isObject() && "text".equals(textOrNull(part.get("type")))) {
          String text = textOrNull(part.get("text"));
          if (text != null) {
            sb.append(text);
          }
        }
      }
      return sb.toString();
    }
    return "";
  }

  public static UserMessage toUserMessage(JsonNode content) {
    if (content == null || content.isNull()) {
      return new UserMessage("");
    }
    if (content.isTextual()) {
      return new UserMessage(content.asText());
    }
    if (!content.isArray()) {
      return new UserMessage("");
    }
    StringBuilder text = new StringBuilder();
    List<Media> media = new ArrayList<>();
    for (JsonNode part : content) {
      if (part == null || !part.isObject()) {
        continue;
      }
      String type = part.path("type").asText();
      if ("text".equals(type)) {
        text.append(part.path("text").asText(""));
      } else if ("image_url".equals(type)) {
        String url = part.path("image_url").path("url").asText(null);
        media.add(toMedia(url));
      }
    }
    return UserMessage.builder().text(text.toString()).media(media).build();
  }

  static Media toMedia(String url) {
    if (url == null || url.isBlank()) {
      throw new MultimodalValidationException("image_unsupported", "image url is missing");
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      throw new MultimodalValidationException(
          "image_unsupported", "http(s) image urls are not accepted in phase 1; use data URIs");
    }
    Matcher matcher = DATA_URI.matcher(url);
    if (!matcher.matches()) {
      throw new MultimodalValidationException(
          "image_unsupported", "unsupported image url or MIME type");
    }
    String mime = matcher.group(1);
    if ("image/jpg".equals(mime)) {
      mime = "image/jpeg";
    }
    byte[] bytes;
    try {
      bytes = Base64.getDecoder().decode(matcher.group(3));
    } catch (IllegalArgumentException ex) {
      throw new MultimodalValidationException("image_unsupported", "invalid base64 image payload");
    }
    return new Media(MimeTypeUtils.parseMimeType(mime), new ByteArrayResource(bytes));
  }

  public static List<Map<String, Object>> normalizedParts(JsonNode content) {
    List<Map<String, Object>> parts = new ArrayList<>();
    if (content == null || content.isNull()) {
      return parts;
    }
    if (content.isTextual()) {
      Map<String, Object> textPart = new LinkedHashMap<>();
      textPart.put("type", "text");
      textPart.put("text", content.asText());
      parts.add(textPart);
      return parts;
    }
    if (content.isArray()) {
      for (JsonNode part : content) {
        if (part == null || !part.isObject()) {
          continue;
        }
        Map<String, Object> map = new LinkedHashMap<>();
        String type = textOrNull(part.get("type"));
        if (type != null) {
          map.put("type", type);
        }
        if ("text".equals(type)) {
          map.put("text", textOrNull(part.get("text")));
        } else if ("image_url".equals(type)) {
          JsonNode imageUrl = part.get("image_url");
          Map<String, Object> imageUrlMap = new LinkedHashMap<>();
          if (imageUrl != null && imageUrl.isObject()) {
            String url = textOrNull(imageUrl.get("url"));
            if (url != null) {
              imageUrlMap.put("url", url);
            }
            String detail = textOrNull(imageUrl.get("detail"));
            if (detail != null) {
              imageUrlMap.put("detail", detail);
            }
          }
          map.put("image_url", imageUrlMap);
        }
        parts.add(map);
      }
    }
    return parts;
  }

  /**
   * When more than {@link #MAX_IMAGES} image_url parts are present, remove the oldest ones (first in
   * message order) by mutating ArrayNode content in place. Non-ArrayNode content is left unchanged.
   */
  private static void dropOldestImagesBeyondLimit(List<ChatMessageDto> messages) {
    if (messages == null) {
      return;
    }
    List<int[]> locs = new ArrayList<>();
    for (int mi = 0; mi < messages.size(); mi++) {
      ChatMessageDto msg = messages.get(mi);
      if (msg == null) {
        continue;
      }
      JsonNode content = msg.content();
      if (content == null || !content.isArray()) {
        continue;
      }
      for (int pi = 0; pi < content.size(); pi++) {
        JsonNode part = content.get(pi);
        if (part != null
            && part.isObject()
            && "image_url".equals(textOrNull(part.get("type")))) {
          locs.add(new int[] {mi, pi});
        }
      }
    }
    if (locs.size() <= MAX_IMAGES) {
      return;
    }
    int dropCount = locs.size() - MAX_IMAGES;
    Map<Integer, List<Integer>> byMsg = new TreeMap<>();
    for (int i = 0; i < dropCount; i++) {
      int[] loc = locs.get(i);
      byMsg.computeIfAbsent(loc[0], k -> new ArrayList<>()).add(loc[1]);
    }
    for (Map.Entry<Integer, List<Integer>> entry : byMsg.entrySet()) {
      JsonNode content = messages.get(entry.getKey()).content();
      if (!(content instanceof ArrayNode array)) {
        continue;
      }
      List<Integer> indices = entry.getValue();
      indices.sort(Comparator.reverseOrder());
      for (int idx : indices) {
        array.remove(idx);
      }
    }
  }

  private static int countImagesInContent(JsonNode content) {
    if (content == null || !content.isArray()) {
      return 0;
    }
    int count = 0;
    for (JsonNode part : content) {
      if (part != null && part.isObject() && "image_url".equals(textOrNull(part.get("type")))) {
        count++;
      }
    }
    return count;
  }

  private static void validateImageUrl(String url) {
    if (url == null || url.isBlank()) {
      throw new MultimodalValidationException("image_unsupported", "image url is missing");
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      throw new MultimodalValidationException(
          "image_unsupported", "http(s) image urls are not accepted in phase 1; use data URIs");
    }
    Matcher matcher = DATA_URI.matcher(url);
    if (!matcher.matches()) {
      throw new MultimodalValidationException(
          "image_unsupported", "unsupported image url or MIME type");
    }
    String mime = matcher.group(1);
    if (!ALLOWED_MIME.contains(mime)) {
      throw new MultimodalValidationException(
          "image_unsupported", "unsupported image MIME type: " + mime);
    }
    String payload = matcher.group(3);
    int decodedBytes = decodedBase64Length(payload);
    if (decodedBytes > MAX_BYTES) {
      throw new MultimodalValidationException(
          "image_limit", "image exceeds maximum size of " + MAX_BYTES + " bytes");
    }
  }

  private static int decodedBase64Length(String payload) {
    try {
      return Base64.getDecoder().decode(payload).length;
    } catch (IllegalArgumentException ex) {
      throw new MultimodalValidationException("image_unsupported", "invalid base64 image payload");
    }
  }

  private static String textOrNull(JsonNode node) {
    if (node == null || node.isNull() || !node.isTextual()) {
      return null;
    }
    return node.asText();
  }
}
