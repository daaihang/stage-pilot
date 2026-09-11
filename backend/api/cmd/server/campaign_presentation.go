package main

import (
	"encoding/json"
	"net/url"
	"strings"
	"unicode/utf8"
)

// The presentation object is the canonical respondent-facing lifecycle
// configuration for a FormVersion. It deliberately lives beside blocks rather
// than inside the sortable block list so a form can have exactly one welcome
// and one ending experience.
func defaultPresentationValue() map[string]any {
	return map[string]any{
		"public_title": "",
		"welcome": map[string]any{
			"enabled":        false,
			"title_mode":     "inherit",
			"title_override": "",
			"description":    "",
			"start_label":    "开始填写",
		},
		"ending": map[string]any{
			"mode":         "default",
			"title":        "",
			"body":         "",
			"redirect_url": "",
		},
	}
}

func normalizePresentationJSON(raw, legacyEnd, rawBlocks json.RawMessage) json.RawMessage {
	presentation := defaultPresentationValue()
	var source map[string]any
	rawPresent := len(raw) > 0 && string(raw) != "null"
	decodeErr := json.Unmarshal(raw, &source)
	if rawPresent && decodeErr != nil {
		// Preserve malformed input for the caller's validation layer instead of
		// silently replacing it with defaults.
		return raw
	}
	hasPresentation := rawPresent && source != nil && len(source) > 0
	if hasPresentation {
		if !validPresentationShape(source) {
			return raw
		}
		mergePresentation(presentation, source)
	} else {
		var end map[string]any
		if json.Unmarshal(legacyEnd, &end) == nil {
			ending := presentation["ending"].(map[string]any)
			if title := stringValue(end, "title"); title != "" {
				ending["mode"], ending["title"] = "custom", title
			}
			if body := stringValue(end, "body"); body != "" {
				ending["mode"], ending["body"] = "custom", body
			}
		}
		var blocks []map[string]any
		if json.Unmarshal(rawBlocks, &blocks) == nil {
			welcome := presentation["welcome"].(map[string]any)
			ending := presentation["ending"].(map[string]any)
			for _, block := range blocks {
				switch stringValue(block, "type") {
				case "welcome":
					welcome["enabled"] = true
					if title := stringValue(block, "title"); title != "" {
						welcome["title_mode"], welcome["title_override"] = "custom", title
					}
					if body := stringValue(block, "body"); body != "" {
						welcome["description"] = body
					}
				case "end":
					ending["mode"] = "custom"
					if title := stringValue(block, "title"); title != "" {
						ending["title"] = title
					}
					if body := stringValue(block, "body"); body != "" {
						ending["body"] = body
					}
				}
			}
		}
	}
	return marshalNormalizedPresentation(presentation)
}

func validPresentationShape(source map[string]any) bool {
	for _, key := range []string{"welcome", "ending"} {
		if raw, ok := source[key]; ok {
			if _, ok := raw.(map[string]any); !ok {
				return false
			}
		}
	}
	if raw, ok := source["public_title"]; ok {
		if _, ok := raw.(string); !ok {
			return false
		}
	}
	if welcome, ok := source["welcome"].(map[string]any); ok {
		if raw, exists := welcome["enabled"]; exists {
			if _, valid := raw.(bool); !valid {
				return false
			}
		}
		for _, key := range []string{"title_mode", "title_override", "description", "start_label"} {
			if raw, exists := welcome[key]; exists {
				if _, valid := raw.(string); !valid {
					return false
				}
			}
		}
	}
	if ending, ok := source["ending"].(map[string]any); ok {
		for _, key := range []string{"mode", "title", "body", "redirect_url"} {
			if raw, exists := ending[key]; exists {
				if _, valid := raw.(string); !valid {
					return false
				}
			}
		}
	}
	return true
}

func mergePresentation(dst, source map[string]any) {
	if title := stringValue(source, "public_title"); title != "" {
		dst["public_title"] = title
	}
	for _, key := range []string{"welcome", "ending"} {
		incoming, ok := source[key].(map[string]any)
		if !ok {
			continue
		}
		target := dst[key].(map[string]any)
		for field, value := range incoming {
			target[field] = value
		}
	}
}

func marshalNormalizedPresentation(value map[string]any) json.RawMessage {
	// Fill defaults after merging partial payloads and discard unknown fields so
	// the ETag and public payload remain deterministic.
	out := defaultPresentationValue()
	if title, ok := value["public_title"].(string); ok {
		out["public_title"] = strings.TrimSpace(title)
	}
	for _, key := range []string{"welcome", "ending"} {
		if source, ok := value[key].(map[string]any); ok {
			target := out[key].(map[string]any)
			for field, value := range source {
				target[field] = value
			}
		}
	}
	welcome := out["welcome"].(map[string]any)
	if _, ok := welcome["enabled"].(bool); !ok {
		welcome["enabled"] = false
	}
	if mode, ok := welcome["title_mode"].(string); !ok || (mode != "inherit" && mode != "custom") {
		welcome["title_mode"] = "inherit"
	}
	for _, key := range []string{"title_override", "description", "start_label"} {
		if text, ok := welcome[key].(string); ok {
			welcome[key] = strings.TrimSpace(text)
		}
	}
	if welcome["start_label"] == "" {
		welcome["start_label"] = "开始填写"
	}
	ending := out["ending"].(map[string]any)
	if mode, ok := ending["mode"].(string); !ok || (mode != "default" && mode != "custom" && mode != "redirect") {
		ending["mode"] = "default"
	}
	for _, key := range []string{"title", "body", "redirect_url"} {
		if text, ok := ending[key].(string); ok {
			ending[key] = strings.TrimSpace(text)
		}
	}
	encoded, _ := json.Marshal(out)
	return encoded
}

func legacyEndScreenFromPresentation(raw json.RawMessage) json.RawMessage {
	var presentation map[string]any
	if json.Unmarshal(raw, &presentation) != nil {
		return json.RawMessage(`{}`)
	}
	ending, _ := presentation["ending"].(map[string]any)
	legacy := map[string]any{"title": stringValue(ending, "title"), "body": stringValue(ending, "body")}
	encoded, _ := json.Marshal(legacy)
	return encoded
}

func setFormPublicTitle(form *formDefinition, title string) {
	if form == nil {
		return
	}
	var presentation map[string]any
	if json.Unmarshal(form.Presentation, &presentation) != nil || presentation == nil {
		presentation = defaultPresentationValue()
	}
	if strings.TrimSpace(stringValue(presentation, "public_title")) == "" {
		presentation["public_title"] = strings.TrimSpace(title)
		form.Presentation = marshalNormalizedPresentation(presentation)
		form.EndScreen = legacyEndScreenFromPresentation(form.Presentation)
	}
}

func validatePresentationValue(form formDefinition) *formValidationError {
	var presentation map[string]any
	if !validJSONType(form.Presentation, "object") || json.Unmarshal(form.Presentation, &presentation) != nil {
		return &formValidationError{"invalid_presentation", "表单展示设置格式无效"}
	}
	publicTitle := stringValue(presentation, "public_title")
	if utf8.RuneCountInString(publicTitle) > 120 {
		return &formValidationError{"invalid_public_title", "对外标题不能超过 120 字"}
	}
	welcome, _ := presentation["welcome"].(map[string]any)
	if enabled, ok := welcome["enabled"]; ok {
		if _, ok := enabled.(bool); !ok {
			return &formValidationError{"invalid_welcome", "欢迎页启用状态无效"}
		}
	}
	if mode := stringValue(welcome, "title_mode"); mode != "" && mode != "inherit" && mode != "custom" {
		return &formValidationError{"invalid_welcome_title_mode", "欢迎页标题模式无效"}
	}
	if utf8.RuneCountInString(stringValue(welcome, "title_override")) > 120 || utf8.RuneCountInString(stringValue(welcome, "description")) > 2000 {
		return &formValidationError{"invalid_welcome_content", "欢迎页内容超出长度限制"}
	}
	if label := stringValue(welcome, "start_label"); utf8.RuneCountInString(label) > 24 {
		return &formValidationError{"invalid_welcome_start_label", "开始按钮文案不能超过 24 字"}
	}
	ending, _ := presentation["ending"].(map[string]any)
	mode := stringValue(ending, "mode")
	if mode != "" && mode != "default" && mode != "custom" && mode != "redirect" {
		return &formValidationError{"invalid_ending_mode", "结束页模式无效"}
	}
	if utf8.RuneCountInString(stringValue(ending, "title")) > 120 || utf8.RuneCountInString(stringValue(ending, "body")) > 2000 {
		return &formValidationError{"invalid_ending_content", "结束页内容超出长度限制"}
	}
	redirect := stringValue(ending, "redirect_url")
	if utf8.RuneCountInString(redirect) > 2048 {
		return &formValidationError{"invalid_redirect_url", "结束页跳转地址过长"}
	}
	if mode == "redirect" {
		parsed, err := url.Parse(redirect)
		if err != nil || strings.ToLower(parsed.Scheme) != "https" || parsed.Host == "" {
			return &formValidationError{"invalid_redirect_url", "结束页跳转地址必须是 HTTPS URL"}
		}
	}
	return nil
}
