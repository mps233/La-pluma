package jsval

import (
	"encoding/json"
	"math"
	"testing"
)

func TestRecordAndArray(t *testing.T) {
	record := map[string]any{"a": 1}
	if got := Record(record); got["a"] != 1 {
		t.Fatalf("record = %#v", got)
	}
	if Record([]any{1}) != nil || Record("x") != nil {
		t.Fatal("non-record accepted")
	}

	array := []any{1, 2}
	if got := Array(array); len(got) != 2 {
		t.Fatalf("array = %#v", got)
	}
	if Array(record) != nil {
		t.Fatal("non-array accepted")
	}
}

func TestStringVariants(t *testing.T) {
	if got := String(nil); got != "undefined" {
		t.Fatalf("String(nil) = %q", got)
	}
	if got := String(0); got != "0" {
		t.Fatalf("String(0) = %q", got)
	}
	if got := StringOrNullish(nil); got != "" {
		t.Fatalf("StringOrNullish(nil) = %q", got)
	}
	if got := StringOrNullish(0); got != "0" {
		t.Fatalf("StringOrNullish(0) = %q", got)
	}
	if got := StringOrEmpty(0); got != "" {
		t.Fatalf("StringOrEmpty(0) = %q", got)
	}
	if got := StringOrEmpty("x"); got != "x" {
		t.Fatalf("StringOrEmpty(x) = %q", got)
	}
	if got := String(1.5); got != "1.5" {
		t.Fatalf("String(1.5) = %q", got)
	}
	if got := String(2.0); got != "2" {
		t.Fatalf("String(2.0) = %q", got)
	}
	if got := String(json.Number("9007199254740993")); got != "9007199254740993" {
		t.Fatalf("String(json.Number) = %q", got)
	}
}

func TestTextIsATypeAssertion(t *testing.T) {
	if got := Text("x"); got != "x" {
		t.Fatalf("Text(x) = %q", got)
	}
	for _, value := range []any{nil, 1, true, []any{}} {
		if got := Text(value); got != "" {
			t.Fatalf("Text(%#v) = %q", value, got)
		}
	}
	if got, ok := TextOK(""); !ok || got != "" {
		t.Fatalf("TextOK(empty) = %q, %v", got, ok)
	}
	if _, ok := TextOK(1); ok {
		t.Fatal("TextOK(1) accepted")
	}
}

func TestTruthy(t *testing.T) {
	falsy := []any{nil, false, "", json.Number("0"), float64(0), 0, uint(0), math.NaN()}
	for _, value := range falsy {
		if Truthy(value) {
			t.Fatalf("%#v is truthy", value)
		}
	}
	truthy := []any{true, "x", json.Number("1"), json.Number("1e999"), 1.5, 1, uint(1), []any{}, map[string]any{}}
	for _, value := range truthy {
		if !Truthy(value) {
			t.Fatalf("%#v is falsy", value)
		}
	}
}

func TestNumberAndInteger(t *testing.T) {
	cases := []struct {
		value any
		want  float64
		ok    bool
	}{
		{nil, 0, false},
		{true, 1, true},
		{false, 0, true},
		{" 42 ", 42, true},
		{"", 0, true},
		{"Infinity", math.Inf(1), true},
		{"-Infinity", math.Inf(-1), true},
		{"nope", 0, false},
		{json.Number("3.5"), 3.5, true},
		{math.NaN(), 0, false},
	}
	for _, tc := range cases {
		got, ok := Number(tc.value)
		if ok != tc.ok || (ok && got != tc.want) {
			t.Fatalf("Number(%#v) = %v, %v; want %v, %v", tc.value, got, ok, tc.want, tc.ok)
		}
	}

	if got := NumberOrZero("nope"); got != 0 {
		t.Fatalf("NumberOrZero = %v", got)
	}
	if got, ok := Integer("3"); !ok || got != 3 {
		t.Fatalf("Integer(3) = %v, %v", got, ok)
	}
	if _, ok := Integer(3.5); ok {
		t.Fatal("Integer(3.5) accepted")
	}
}

func TestStringJSON(t *testing.T) {
	cases := []struct {
		value any
		want  string
	}{
		{nil, "null"},
		{"x", "x"},
		{true, "true"},
		{json.Number("9007199254740993"), "9007199254740993"},
		{[]any{"a", nil, 2}, "a,,2"},
		{[]string{"a", "b"}, "a,b"},
		{map[string]any{"a": 1}, "[object Object]"},
	}
	for _, tc := range cases {
		if got := StringJSON(tc.value); got != tc.want {
			t.Fatalf("StringJSON(%#v) = %q, want %q", tc.value, got, tc.want)
		}
	}
}

func TestFormatFloatMatchesJavaScript(t *testing.T) {
	cases := []struct {
		value float64
		want  string
	}{
		{2, "2"},
		{1.5, "1.5"},
		{1e20, "100000000000000000000"},
		{1e21, "1e+21"},
		{0.000001, "0.000001"},
		{1e-7, "1e-7"},
		{-1.5e-8, "-1.5e-8"},
		{math.NaN(), "NaN"},
		{math.Inf(1), "Infinity"},
	}
	for _, tc := range cases {
		if got := FormatFloat(tc.value); got != tc.want {
			t.Fatalf("FormatFloat(%v) = %q, want %q", tc.value, got, tc.want)
		}
	}
}

func TestFiniteNumber(t *testing.T) {
	cases := []struct {
		value any
		want  float64
		ok    bool
	}{
		{nil, 0, false},
		{true, 1, true},
		{" 42 ", 42, true},
		{"", 0, true},
		{"1e999", 0, false},
		{"Infinity", 0, false},
		{"NaN", 0, false},
		{"nope", 0, false},
		{json.Number("3.5"), 3.5, true},
		{math.Inf(1), 0, false},
		{math.NaN(), 0, false},
	}
	for _, tc := range cases {
		got, ok := FiniteNumber(tc.value)
		if ok != tc.ok || (ok && got != tc.want) {
			t.Fatalf("FiniteNumber(%#v) = %v, %v; want %v, %v", tc.value, got, ok, tc.want, tc.ok)
		}
	}
	if got, ok := FiniteNumberOrNull(nil); !ok || got != 0 {
		t.Fatalf("FiniteNumberOrNull(nil) = %v, %v", got, ok)
	}
	if got := FiniteNumberOrZero("Infinity"); got != 0 {
		t.Fatalf("FiniteNumberOrZero = %v", got)
	}
}

func TestNumeric(t *testing.T) {
	if got, ok := Numeric(json.Number("2")); !ok || got != 2 {
		t.Fatalf("Numeric(2) = %v, %v", got, ok)
	}
	for _, value := range []any{nil, "2", true, math.Inf(1)} {
		if _, ok := Numeric(value); ok {
			t.Fatalf("Numeric(%#v) accepted", value)
		}
	}
}

func TestParseAndDecodeJSON(t *testing.T) {
	value, err := ParseJSON([]byte(`{"id":9007199254740993}`))
	if err != nil {
		t.Fatal(err)
	}
	record := Record(value)
	if record["id"] != json.Number("9007199254740993") {
		t.Fatalf("id = %#v", record["id"])
	}

	var decoded map[string]any
	if err := DecodeJSON([]byte(`{"id":9007199254740993}`), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["id"] != json.Number("9007199254740993") {
		t.Fatalf("decoded id = %#v", decoded["id"])
	}
}
