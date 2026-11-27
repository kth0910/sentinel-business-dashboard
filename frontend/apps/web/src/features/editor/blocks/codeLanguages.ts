// Code block languages supported by the picker (88 entries,
// Supported language labels, including ASCII Art, Assembly, BNF/EBNF, HCL, Formula, Rocq, Smalltalk, and Solidity.
export const CODE_LANGUAGES: string[] = ["ABAP", "Agda", "Arduino", "ASCII Art", "Assembly", "Bash", "BASIC", "BNF", "C", "C#", "C++", "Clojure", "CoffeeScript", "CSS", "Dart", "Dhall", "Diff", "Docker", "EBNF", "Elixir", "Elm", "Erlang", "F#", "Flow", "Fortran", "Gherkin", "GLSL", "Go", "GraphQL", "Groovy", "Haskell", "HCL", "HTML", "Idris", "Java", "JavaScript", "JSON", "Julia", "Kotlin", "LaTeX", "Less", "Lisp", "LiveScript", "LLVM IR", "Lua", "Makefile", "Markdown", "Markup", "Mathematica", "MATLAB", "Mermaid", "Nix", "Litpage Formula", "Objective-C", "OCaml", "Pascal", "Perl", "PHP", "Plain Text", "PowerShell", "Prolog", "Protobuf", "PureScript", "Python", "R", "Racket", "Reason", "Rocq", "Ruby", "Rust", "Sass", "Scala", "Scheme", "SCSS", "Shell", "Smalltalk", "Solidity", "SQL", "Swift", "TOML", "TypeScript", "VB.Net", "Verilog", "VHDL", "Visual Basic", "WebAssembly", "XML", "YAML"];

/** 저장된 언어 값 → 화면에 보이는 이름. 저장 값과 하이라이트 키는 그대로 두고 표시만 바꾼다. */
const DISPLAY_LABELS: Record<string, string> = { 'Litpage Formula': 'CoolNotion! Formula' };
export function languageLabel(stored: string): string {
  return DISPLAY_LABELS[stored] ?? stored;
}
