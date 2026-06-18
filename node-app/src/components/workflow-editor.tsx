"use client";

import { useState, useEffect } from "react";
import { ToolId, TOOL_REGISTRY } from "@/lib/ai-tools";
import { StepConfig, IterativeStepConfig } from "@/lib/workflow-config";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const MODEL_TOKEN_LIMITS: Record<string, { name: string; maxOutput: number }> = {
  "sonnet-4.6": { name: "Sonnet 4.6", maxOutput: 64000 },
  "claude-sonnet-4-6": { name: "Sonnet 4.6", maxOutput: 64000 },
  "opus-4.6": { name: "Opus 4.6", maxOutput: 128000 },
  "claude-opus-4-6": { name: "Opus 4.6", maxOutput: 128000 },
  "sonnet-4.5": { name: "Sonnet 4.5", maxOutput: 64000 },
  "claude-sonnet-4-5-20250929": { name: "Sonnet 4.5", maxOutput: 64000 },
  "opus-4.5": { name: "Opus 4.5", maxOutput: 32000 },
  "claude-opus-4-5-20251101": { name: "Opus 4.5", maxOutput: 32000 },
  "opus-4.1": { name: "Opus 4.1", maxOutput: 64000 },
  "claude-opus-4-1-20250805": { name: "Opus 4.1", maxOutput: 64000 },
  "opus-4": { name: "Opus 4", maxOutput: 32000 },
  "claude-opus-4-20250514": { name: "Opus 4", maxOutput: 32000 },
  "sonnet-4": { name: "Sonnet 4", maxOutput: 16000 },
  "claude-sonnet-4-20250514": { name: "Sonnet 4", maxOutput: 16000 },
  "sonnet-3.7": { name: "Sonnet 3.7", maxOutput: 16000 },
  "claude-3-7-sonnet-20250219": { name: "Sonnet 3.7", maxOutput: 16000 },
  "haiku-4.5": { name: "Haiku 4.5", maxOutput: 8192 },
  "claude-haiku-4-5-20251001": { name: "Haiku 4.5", maxOutput: 8192 },
  "haiku-3.5": { name: "Haiku 3.5", maxOutput: 8192 },
  "claude-3-5-haiku-20241022": { name: "Haiku 3.5", maxOutput: 8192 },
  "haiku-3": { name: "Haiku 3", maxOutput: 4096 },
  "claude-3-haiku-20240307": { name: "Haiku 3", maxOutput: 4096 },
};

interface WorkflowEditorProps {
  step: StepConfig;
  onUpdate: (step: StepConfig) => void;
  onReset: () => void;
  activeModelId?: string;
  envStatus?: {
    courtlistener: boolean;
    tavily: boolean;
    browserless: boolean;
  };
}

export function WorkflowEditor({
  step,
  onUpdate,
  onReset,
  activeModelId,
  envStatus,
}: WorkflowEditorProps) {
  const modelInfo = activeModelId ? MODEL_TOKEN_LIMITS[activeModelId] : undefined;
  const sliderMax = modelInfo?.maxOutput || 128000;
  const [localStep, setLocalStep] = useState<StepConfig>(step);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync local state when step prop changes (when user selects different step)
  useEffect(() => {
    setLocalStep(step);
    setHasChanges(false);
  }, [step.id]); // Re-sync when step ID changes

  // Helper to check if an environment variable is configured
  const isEnvVarConfigured = (envVar: string): boolean => {
    if (!envStatus) return true; // Optimistically assume configured until we know

    // Map env var names to envStatus keys
    const envMap: Record<string, keyof typeof envStatus> = {
      COURTLISTENER_API_KEY: "courtlistener",
      TAVILY_API_KEY: "tavily",
      BROWSERLESS_API_KEY: "browserless",
    };

    const statusKey = envMap[envVar];
    return statusKey ? envStatus[statusKey] : true;
  };

  const handlePromptChange = (newPrompt: string) => {
    setLocalStep({ ...localStep, systemPrompt: newPrompt });
    setHasChanges(true);
  };

  const handleToolToggle = (toolId: ToolId) => {
    const currentTools = localStep.availableTools;
    const newTools = currentTools.includes(toolId)
      ? currentTools.filter((t) => t !== toolId)
      : [...currentTools, toolId];
    setLocalStep({ ...localStep, availableTools: newTools });
    setHasChanges(true);
  };

  const handleParamChange = (
    param: keyof typeof localStep.modelParams,
    value: number,
  ) => {
    setLocalStep({
      ...localStep,
      modelParams: { ...localStep.modelParams, [param]: value },
    });
    setHasChanges(true);
  };

  const handleExtendedThinkingToggle = () => {
    const currentThinking = localStep.modelParams.extendedThinking;
    setLocalStep({
      ...localStep,
      modelParams: {
        ...localStep.modelParams,
        extendedThinking: {
          enabled: !currentThinking?.enabled,
          budgetTokens: currentThinking?.budgetTokens || 10000,
        },
      },
    });
    setHasChanges(true);
  };

  const handleThinkingBudgetChange = (value: number) => {
    const currentThinking = localStep.modelParams.extendedThinking;
    setLocalStep({
      ...localStep,
      modelParams: {
        ...localStep.modelParams,
        extendedThinking: {
          enabled: currentThinking?.enabled ?? true,
          budgetTokens: value,
        },
      },
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    onUpdate(localStep);
    setHasChanges(false);
  };

  const handleResetToDefault = () => {
    onReset();
    setHasChanges(false);
  };

  const handleToggleEnabled = () => {
    const updated = { ...localStep, enabled: !localStep.enabled };
    setLocalStep(updated);
    setHasChanges(true);
  };

  // Iteration configuration handlers
  const handleIterativeToggle = () => {
    const currentConfig = localStep.iterativeConfig;
    setLocalStep({
      ...localStep,
      iterativeConfig: currentConfig?.enabled
        ? { ...currentConfig, enabled: false }
        : {
            enabled: true,
            itemExtractionMode: "ai-identified",
            iterationPromptTemplate:
              "Analyze the following item in detail:\n\n{item}",
            maxIterations: 25,
            aggregateResults: true,
            aggregationPrompt:
              "Synthesize the key findings from all iterations above.",
            aiDiscretionEnabled: true,
          },
    });
    setHasChanges(true);
  };

  const handleIterativeConfigChange = (
    field: keyof IterativeStepConfig,
    value: unknown,
  ) => {
    setLocalStep({
      ...localStep,
      iterativeConfig: {
        ...localStep.iterativeConfig!,
        [field]: value,
      },
    });
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{localStep.name}</h2>
            <Badge variant={localStep.enabled ? "default" : "secondary"}>
              {localStep.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <Badge variant="outline">Step {localStep.order}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {localStep.description}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleToggleEnabled}>
            {localStep.enabled ? "Disable" : "Enable"} Step
          </Button>
          {hasChanges && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetToDefault}
              >
                Reset to Default
              </Button>
              <Button size="sm" onClick={handleSave}>
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs for different configuration sections */}
      <Tabs defaultValue="prompt" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
          <TabsTrigger value="iteration">Iteration</TabsTrigger>
        </TabsList>

        {/* System Prompt Editor */}
        <TabsContent value="prompt" className="space-y-4">
          <Card className="p-4">
            <Label htmlFor="system-prompt" className="text-base font-semibold">
              System Prompt
            </Label>
            <p className="text-sm text-muted-foreground mb-3">
              This prompt guides the AI's analysis for this specific step. Be
              clear and specific about what to evaluate.
            </p>
            <textarea
              id="system-prompt"
              value={localStep.systemPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              className="w-full min-h-[400px] p-3 border rounded-md font-mono text-sm"
              placeholder="Enter the system prompt for this step..."
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {localStep.systemPrompt.length} characters | ~
              {Math.ceil(localStep.systemPrompt.length / 4)} tokens
            </div>
          </Card>
        </TabsContent>

        {/* Tool Selection */}
        <TabsContent value="tools" className="space-y-4">
          <Card className="p-4">
            <Label className="text-base font-semibold">Available Tools</Label>
            <p className="text-sm text-muted-foreground mb-4">
              Select which tools the AI can use during this step. Tools enable
              the AI to search cases, look up statutes, and more.
            </p>

            {/* Group tools by category */}
            {Object.entries(
              Object.entries(TOOL_REGISTRY).reduce(
                (acc, [id, tool]) => {
                  if (!acc[tool.category]) acc[tool.category] = [];
                  acc[tool.category].push({ id: id as ToolId, ...tool });
                  return acc;
                },
                {} as Record<string, any[]>,
              ),
            ).map(([category, tools]) => (
              <div key={category} className="mb-6">
                <h3 className="font-semibold text-sm mb-3">{category}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {tools.map((tool) => {
                    const isSelected = localStep.availableTools.includes(
                      tool.id,
                    );
                    const missingEnvVars = tool.requiredEnvVars.filter(
                      (v: string) => !isEnvVarConfigured(v),
                    );
                    const hasRequiredEnv = missingEnvVars.length === 0;

                    return (
                      <Card
                        key={tool.id}
                        className={`p-3 cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "hover:border-primary/50"
                        } ${!hasRequiredEnv ? "opacity-50" : ""}`}
                        onClick={() =>
                          hasRequiredEnv && handleToolToggle(tool.id)
                        }
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-2xl">{tool.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-sm">
                                {tool.name}
                              </h4>
                              {isSelected && (
                                <Badge variant="default" className="text-xs">
                                  ✓
                                </Badge>
                              )}
                              {!hasRequiredEnv && (
                                <Badge
                                  variant="destructive"
                                  className="text-xs"
                                >
                                  Config Required
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {tool.description}
                            </p>
                            {!hasRequiredEnv && (
                              <p className="text-xs text-destructive mt-1">
                                Missing: {missingEnvVars.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-4 p-3 bg-muted rounded-md">
              <p className="text-sm font-medium">
                Selected: {localStep.availableTools.length} tool(s)
              </p>
              {localStep.availableTools.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {localStep.availableTools.map((toolId) => {
                    const tool = TOOL_REGISTRY[toolId];
                    return (
                      <Badge key={toolId} variant="secondary">
                        {tool.icon} {tool.name}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Model Parameters */}
        <TabsContent value="parameters" className="space-y-4">
          <Card className="p-4 space-y-6">
            <div>
              <Label className="text-base font-semibold">
                Model Parameters
              </Label>
              <p className="text-sm text-muted-foreground">
                Fine-tune how the AI behaves during this step.
              </p>
            </div>

            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="temperature">Temperature</Label>
                <span className="text-sm font-mono">
                  {localStep.modelParams.temperature}
                </span>
              </div>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.1}
                value={[localStep.modelParams.temperature]}
                onValueChange={([value]: number[]) =>
                  handleParamChange("temperature", value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Lower = more focused and deterministic. Higher = more creative
                and varied.
              </p>
            </div>

            {/* Max Tokens */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="maxTokens">Max Output Tokens</Label>
                <span className="text-sm font-mono">
                  {localStep.modelParams.maxTokens.toLocaleString()}
                </span>
              </div>
              <Slider
                id="maxTokens"
                min={1000}
                max={sliderMax}
                step={1000}
                value={[localStep.modelParams.maxTokens]}
                onValueChange={([value]: number[]) =>
                  handleParamChange("maxTokens", value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Maximum length of the AI&apos;s response.{" "}
                {modelInfo
                  ? `${modelInfo.name} supports up to ${(modelInfo.maxOutput / 1000).toFixed(0)}k tokens.`
                  : "Select a model in Settings to see its token limit."}
              </p>
            </div>

            {/* Top P */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="topP">Top P (Nucleus Sampling)</Label>
                <span className="text-sm font-mono">
                  {localStep.modelParams.topP}
                </span>
              </div>
              <Slider
                id="topP"
                min={0}
                max={1}
                step={0.05}
                value={[localStep.modelParams.topP]}
                onValueChange={([value]: number[]) =>
                  handleParamChange("topP", value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Controls diversity via nucleus sampling. Lower = more focused.
              </p>
            </div>

            {/* Frequency Penalty */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="frequencyPenalty">Frequency Penalty</Label>
                <span className="text-sm font-mono">
                  {localStep.modelParams.frequencyPenalty}
                </span>
              </div>
              <Slider
                id="frequencyPenalty"
                min={-2}
                max={2}
                step={0.1}
                value={[localStep.modelParams.frequencyPenalty]}
                onValueChange={([value]: number[]) =>
                  handleParamChange("frequencyPenalty", value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Penalize frequent tokens. Positive = reduce repetition.
              </p>
            </div>

            {/* Presence Penalty */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="presencePenalty">Presence Penalty</Label>
                <span className="text-sm font-mono">
                  {localStep.modelParams.presencePenalty}
                </span>
              </div>
              <Slider
                id="presencePenalty"
                min={-2}
                max={2}
                step={0.1}
                value={[localStep.modelParams.presencePenalty]}
                onValueChange={([value]: number[]) =>
                  handleParamChange("presencePenalty", value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Penalize already-used tokens. Positive = encourage new topics.
              </p>
            </div>

            {/* Max Steps */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="maxSteps">Max Tool Calling Steps</Label>
                <span className="text-sm font-mono">
                  {localStep.modelParams.maxSteps}
                </span>
              </div>
              <Slider
                id="maxSteps"
                min={1}
                max={20}
                step={1}
                value={[localStep.modelParams.maxSteps]}
                onValueChange={([value]: number[]) =>
                  handleParamChange("maxSteps", value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of tool calls allowed during this step (for
                multi-step agent workflows).
              </p>
            </div>

            {/* Extended Thinking Section */}
            <div className="pt-4 border-t space-y-4">
              <div>
                <Label className="text-base font-semibold">
                  Extended Thinking
                </Label>
                <p className="text-sm text-muted-foreground">
                  Claude 4+ models can use extended thinking for complex
                  reasoning. The AI "thinks" before responding.
                </p>
              </div>

              {/* Extended Thinking Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="extendedThinking">
                    Enable Extended Thinking
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allows the AI to reason through complex legal issues before
                    generating output
                  </p>
                </div>
                <button
                  id="extendedThinking"
                  type="button"
                  role="switch"
                  aria-checked={
                    localStep.modelParams.extendedThinking?.enabled ?? false
                  }
                  onClick={handleExtendedThinkingToggle}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full
                    transition-colors focus-visible:outline-none focus-visible:ring-2 
                    focus-visible:ring-ring focus-visible:ring-offset-2
                    ${localStep.modelParams.extendedThinking?.enabled ? "bg-primary" : "bg-input"}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-background 
                      transition-transform
                      ${localStep.modelParams.extendedThinking?.enabled ? "translate-x-6" : "translate-x-1"}
                    `}
                  />
                </button>
              </div>

              {/* Thinking Budget Slider (only show when enabled) */}
              {localStep.modelParams.extendedThinking?.enabled && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="thinkingBudget">
                      Thinking Token Budget
                    </Label>
                    <span className="text-sm font-mono">
                      {(
                        localStep.modelParams.extendedThinking?.budgetTokens ||
                        10000
                      ).toLocaleString()}
                    </span>
                  </div>
                  <Slider
                    id="thinkingBudget"
                    min={1000}
                    max={32000}
                    step={1000}
                    value={[
                      localStep.modelParams.extendedThinking?.budgetTokens ||
                        10000,
                    ]}
                    onValueChange={([value]: number[]) =>
                      handleThinkingBudgetChange(value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Tokens allocated for internal reasoning. Higher values allow
                    deeper analysis but cost more.
                  </p>
                </div>
              )}
            </div>

            {/* Preset Buttons */}
            <div className="pt-4 border-t">
              <Label className="text-sm font-semibold mb-3 block">
                Parameter Presets
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLocalStep({
                      ...localStep,
                      modelParams: {
                        temperature: 0.1,
                        maxTokens: 4096,
                        topP: 0.9,
                        frequencyPenalty: 0,
                        presencePenalty: 0,
                        maxSteps: 10,
                      },
                    })
                  }
                >
                  📊 Analytical (Precise)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLocalStep({
                      ...localStep,
                      modelParams: {
                        temperature: 0.3,
                        maxTokens: 4096,
                        topP: 0.9,
                        frequencyPenalty: 0,
                        presencePenalty: 0,
                        maxSteps: 5,
                      },
                    })
                  }
                >
                  ⚖️ Balanced (Default)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLocalStep({
                      ...localStep,
                      modelParams: {
                        temperature: 0.7,
                        maxTokens: 4096,
                        topP: 0.9,
                        frequencyPenalty: 0.3,
                        presencePenalty: 0.3,
                        maxSteps: 3,
                      },
                    })
                  }
                >
                  💡 Creative (Suggestions)
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Iteration Configuration */}
        <TabsContent value="iteration" className="space-y-4">
          <Card className="p-4 space-y-6">
            <div>
              <Label className="text-base font-semibold">
                Iterative Step Execution
              </Label>
              <p className="text-sm text-muted-foreground">
                Enable this step to be executed multiple times across a series
                of items (e.g., briefing each legal case separately).
              </p>
            </div>

            {/* Enable Iteration Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="iterativeEnabled">Enable Iterative Mode</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, the AI can trigger iteration across multiple
                  items
                </p>
              </div>
              <button
                id="iterativeEnabled"
                type="button"
                role="switch"
                aria-checked={localStep.iterativeConfig?.enabled ?? false}
                onClick={handleIterativeToggle}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full
                  transition-colors focus-visible:outline-none focus-visible:ring-2 
                  focus-visible:ring-ring focus-visible:ring-offset-2
                  ${localStep.iterativeConfig?.enabled ? "bg-primary" : "bg-input"}
                `}
              >
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-background 
                    transition-transform
                    ${localStep.iterativeConfig?.enabled ? "translate-x-6" : "translate-x-1"}
                  `}
                />
              </button>
            </div>

            {/* Iteration Settings (only show when enabled) */}
            {localStep.iterativeConfig?.enabled && (
              <>
                {/* Item Extraction Mode */}
                <div className="space-y-2">
                  <Label htmlFor="extractionMode">Item Extraction Mode</Label>
                  <select
                    id="extractionMode"
                    value={localStep.iterativeConfig.itemExtractionMode}
                    onChange={(e) =>
                      handleIterativeConfigChange(
                        "itemExtractionMode",
                        e.target.value,
                      )
                    }
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="ai-identified">
                      AI-Identified (AI decides what to iterate over)
                    </option>
                    <option value="regex-pattern">
                      Regex Pattern (Extract using pattern)
                    </option>
                    <option value="tool-result">
                      Tool Result (Use tool output)
                    </option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    How items to iterate over are identified
                  </p>
                </div>

                {/* Regex Pattern (only for regex mode) */}
                {localStep.iterativeConfig.itemExtractionMode ===
                  "regex-pattern" && (
                  <div className="space-y-2">
                    <Label htmlFor="extractionPattern">
                      Extraction Pattern
                    </Label>
                    <input
                      id="extractionPattern"
                      type="text"
                      value={localStep.iterativeConfig.extractionPattern || ""}
                      onChange={(e) =>
                        handleIterativeConfigChange(
                          "extractionPattern",
                          e.target.value,
                        )
                      }
                      className="w-full p-2 border rounded-md font-mono text-sm"
                      placeholder="e.g., \\d+\\s+F\\.\\d+\\s+\\d+"
                    />
                    <p className="text-xs text-muted-foreground">
                      Regular expression to extract items from document
                    </p>
                  </div>
                )}

                {/* Max Iterations */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="maxIterations">Max Iterations</Label>
                    <span className="text-sm font-mono">
                      {localStep.iterativeConfig.maxIterations}
                    </span>
                  </div>
                  <Slider
                    id="maxIterations"
                    min={1}
                    max={50}
                    step={1}
                    value={[localStep.iterativeConfig.maxIterations]}
                    onValueChange={([value]: number[]) =>
                      handleIterativeConfigChange("maxIterations", value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of items to process (prevents runaway
                    iterations)
                  </p>
                </div>

                {/* Iteration Prompt Template */}
                <div className="space-y-2">
                  <Label htmlFor="iterationPrompt">
                    Iteration Prompt Template
                  </Label>
                  <textarea
                    id="iterationPrompt"
                    value={localStep.iterativeConfig.iterationPromptTemplate}
                    onChange={(e) =>
                      handleIterativeConfigChange(
                        "iterationPromptTemplate",
                        e.target.value,
                      )
                    }
                    className="w-full min-h-[100px] p-2 border rounded-md font-mono text-sm"
                    placeholder="Use {item} as placeholder for current item"
                  />
                  <p className="text-xs text-muted-foreground">
                    Template for each iteration. Use {"{item}"} as placeholder.
                  </p>
                </div>

                {/* Aggregate Results Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="aggregateResults">Aggregate Results</Label>
                    <p className="text-xs text-muted-foreground">
                      Synthesize findings from all iterations into a summary
                    </p>
                  </div>
                  <button
                    id="aggregateResults"
                    type="button"
                    role="switch"
                    aria-checked={localStep.iterativeConfig.aggregateResults}
                    onClick={() =>
                      handleIterativeConfigChange(
                        "aggregateResults",
                        !localStep.iterativeConfig!.aggregateResults,
                      )
                    }
                    className={`
                      relative inline-flex h-6 w-11 items-center rounded-full
                      transition-colors focus-visible:outline-none focus-visible:ring-2 
                      focus-visible:ring-ring focus-visible:ring-offset-2
                      ${localStep.iterativeConfig.aggregateResults ? "bg-primary" : "bg-input"}
                    `}
                  >
                    <span
                      className={`
                        inline-block h-4 w-4 transform rounded-full bg-background 
                        transition-transform
                        ${localStep.iterativeConfig.aggregateResults ? "translate-x-6" : "translate-x-1"}
                      `}
                    />
                  </button>
                </div>

                {/* Aggregation Prompt (only when aggregation enabled) */}
                {localStep.iterativeConfig.aggregateResults && (
                  <div className="space-y-2">
                    <Label htmlFor="aggregationPrompt">
                      Aggregation Prompt
                    </Label>
                    <textarea
                      id="aggregationPrompt"
                      value={localStep.iterativeConfig.aggregationPrompt || ""}
                      onChange={(e) =>
                        handleIterativeConfigChange(
                          "aggregationPrompt",
                          e.target.value,
                        )
                      }
                      className="w-full min-h-[80px] p-2 border rounded-md font-mono text-sm"
                      placeholder="Instructions for synthesizing iteration results"
                    />
                    <p className="text-xs text-muted-foreground">
                      Prompt for creating the final synthesis of all iterations
                    </p>
                  </div>
                )}

                {/* AI Discretion Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="aiDiscretion">AI Discretion</Label>
                    <p className="text-xs text-muted-foreground">
                      Allow AI to decide whether iteration is needed
                    </p>
                  </div>
                  <button
                    id="aiDiscretion"
                    type="button"
                    role="switch"
                    aria-checked={localStep.iterativeConfig.aiDiscretionEnabled}
                    onClick={() =>
                      handleIterativeConfigChange(
                        "aiDiscretionEnabled",
                        !localStep.iterativeConfig!.aiDiscretionEnabled,
                      )
                    }
                    className={`
                      relative inline-flex h-6 w-11 items-center rounded-full
                      transition-colors focus-visible:outline-none focus-visible:ring-2 
                      focus-visible:ring-ring focus-visible:ring-offset-2
                      ${localStep.iterativeConfig.aiDiscretionEnabled ? "bg-primary" : "bg-input"}
                    `}
                  >
                    <span
                      className={`
                        inline-block h-4 w-4 transform rounded-full bg-background 
                        transition-transform
                        ${localStep.iterativeConfig.aiDiscretionEnabled ? "translate-x-6" : "translate-x-1"}
                      `}
                    />
                  </button>
                </div>
              </>
            )}

            {/* Info Box */}
            <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-md border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                <strong>How it works:</strong> When iteration is enabled, the AI
                can call the <code>iterate-step</code> tool to process multiple
                items (like legal cases) one at a time. Each item gets focused
                analysis with full document context maintained.
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Warning for changes */}
      {hasChanges && (
        <Card className="p-4 bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800">
          <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
            ⚠️ You have unsaved changes. Click "Save Changes" to apply them.
          </p>
        </Card>
      )}
    </div>
  );
}
