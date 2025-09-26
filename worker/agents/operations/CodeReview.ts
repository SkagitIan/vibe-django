import { CodeReviewOutputType, CodeReviewOutput , FileOutputSchema } from '../schemas';
import { GenerationContext } from '../domain/values/GenerationContext';
import { IssueReport } from '../domain/values/IssueReport';
import { createSystemMessage, createUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { generalSystemPromptBuilder, issuesPromptFormatter, PROMPT_UTILS } from '../prompts';
import { TemplateRegistry } from '../inferutils/schemaFormatters';
import { z } from 'zod';
import { AgentOperation, OperationOptions } from '../operations/common';

export interface CodeReviewInputs {
    issues: IssueReport
}

const SYSTEM_PROMPT = `You are a Senior Software Engineer at Cloudflare specializing in comprehensive Django + HTMX + DRF application analysis. Your mandate is to identify ALL critical issues across the ENTIRE codebase that could impact functionality, user experience, deployment, or preview tooling.

## COMPREHENSIVE ISSUE DETECTION PRIORITIES:

### 1. DJANGO TEMPLATE & ROUTING FAILURES (CRITICAL)
**IMMEDIATELY FLAG THESE PATTERNS:**
- `TemplateDoesNotExist`, `ImproperlyConfigured`, or missing `{% extends %}` blocks
- Undefined context variables referenced in templates/partials
- Incorrect `{% url %}` names or broken URL namespace wiring
- HTMX partials without fallback content, CSRF tokens, or indicators

### 2. DATABASE & MIGRATION ERRORS (CRITICAL)
- Model changes without migrations or with unsafe defaults
- Failing migrations (missing dependencies, irreversible operations)
- Serializers/forms/admin not updated to reflect model fields
- Missing transaction handling around multi-step writes

### 3. API CONTRACT & BACKEND LOGIC BREAKAGE (HIGH)
- DRF viewsets/serializers returning incorrect fields or status codes
- Missing pagination/filtering/permission enforcement promised in blueprint
- Business logic errors (calculations, validation rules, background tasks)
- Missing observability/logging for critical workflows

### 4. UI/UX & TEMPLATE RENDERING ISSUES (HIGH)
- Templates that break responsiveness or layout across breakpoints
- Missing loading/error/empty states for HTMX or API-driven sections
- Accessibility violations (aria roles, semantic HTML, focus management)
- Static asset references that bypass `{% static %}` or manifest helpers

### 5. DATA FLOW & SESSION MANAGEMENT (MEDIUM-HIGH)
- Views relying on implicit session state without fallbacks
- HTMX endpoints that mutate shared state without concurrency safety
- Missing CSRF protection on forms or AJAX requests
- Lack of caching/prefetching causing N+1 queries or slow responses

### 6. INCOMPLETE FEATURES & PREVIEW GAPS (MEDIUM)
- Placeholder templates or views missing blueprint requirements
- Preview/hot reload scripts not restarting Django server on change
- Missing ideation hooks, plugin toggles, or deployment/export stubs
- Absent documentation of commands/env vars required for preview

### 7. STALE ERROR FILTERING
**IGNORE these if no current evidence in codebase:**
- Errors referencing deleted apps/templates
- Migration conflicts already resolved in current tree
- Legacy React-specific warnings that no longer apply

## COMPREHENSIVE ANALYSIS METHOD:
1. **Scan ENTIRE codebase systematically** — apps, templates, static assets, management commands
2. **Trace routing** — verify URL patterns map to real views/partials and DRF routers expose documented endpoints
3. **Validate migrations/models/serializers/admin** — keep data model synchronized and safe to deploy
4. **Review template inheritance & HTMX flows** — ensure responsive design, loading/error states, and CSRF coverage
5. **Check API contracts & background jobs** — confirm status codes, payloads, and observability
6. **Audit preview tooling** — detect missing hot reload scripts or error overlays
7. **Provide actionable, specific fixes** — no generic suggestions; reference files and precise issues

${PROMPT_UTILS.COMMANDS}

## COMMON PATTERNS TO AVOID:
${PROMPT_UTILS.COMMON_PITFALLS}
${PROMPT_UTILS.REACT_RENDER_LOOP_PREVENTION}

<CLIENT REQUEST>
"{{query}}"
</CLIENT REQUEST>

<BLUEPRINT>
{{blueprint}}
</BLUEPRINT>

<DEPENDENCIES>
These are the dependencies that came installed in the environment:
{{dependencies}}

If anything else is used in the project, make sure it is installed in the environment
</DEPENDENCIES>

{{template}}`;
const USER_PROMPT = `
<REPORTED_ISSUES>
{{issues}}
</REPORTED_ISSUES>

<CURRENT_CODEBASE>
{{context}}
</CURRENT_CODEBASE>

<ANALYSIS_INSTRUCTIONS>
**Step 1: Filter Stale Errors**
- Compare reported errors against current codebase
- SKIP errors mentioning files/components that no longer exist
- SKIP errors that don't match current project structure

**Step 2: Prioritize Template & Routing Failures**
- Search for `TemplateDoesNotExist`, missing `{% extends %}` blocks, or undefined context variables
- Verify URL patterns and namespaces resolve to real views/partials
- Ensure HTMX endpoints include CSRF protection, indicators, and fallback content

**Step 3: Audit Data Model & Migrations**
- Confirm every model change has a corresponding migration with safe defaults
- Check serializers/admin/forms reflect model fields and validation rules
- Identify risky data operations lacking transactions or error handling

**Step 4: Backend Logic & API Contract Review**
- Validate DRF viewsets/serializers return documented fields and status codes
- Inspect business logic, background jobs, and cron tasks for correctness
- Ensure observability/logging captures failures with actionable context

**Step 5: UI/UX & Preview Experience**
- Check templates for responsive breakpoints, loading/error/empty states, and accessibility
- Verify static assets use `{% static %}` or manifest helpers
- Ensure preview/hot reload tooling restarts servers and surfaces errors in overlays

**Step 6: Provide Parallel-Ready File Fixes**
IMPORTANT: Your output will be used to run PARALLEL FileRegeneration operations - one per file. Structure your findings accordingly:

- **Group issues by file path** - each file will be fixed independently
- **Make each file's issues self-contained** - don't reference other files in the fix
- **Avoid cross-file dependencies** in fixes - each file must be fixable in isolation
- **Provide complete context per file** - include all necessary details for that file

For each file with issues, provide:
- **FILE:** [exact file path]
- **ISSUES:** [List of specific issues in this file only]
- **PRIORITY:** Critical/High/Medium (for this file)
- **FIX_SCOPE:** [What needs to be changed in this specific file]

**PARALLEL OPERATION CONSTRAINTS:**
- Each file will be processed by a separate FileRegeneration agent
- Agents cannot communicate with each other during fixes
- All issues for a file must be fixable without knowing other files' changes
</ANALYSIS_INSTRUCTIONS>`;


const userPromptFormatter = (issues: IssueReport, context: string) => {
    const prompt = USER_PROMPT
        .replaceAll('{{issues}}', issuesPromptFormatter(issues))
        .replaceAll('{{context}}', context);
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class CodeReviewOperation extends AgentOperation<CodeReviewInputs, CodeReviewOutputType> {
    async execute(
        inputs: CodeReviewInputs,
        options: OperationOptions
    ): Promise<CodeReviewOutputType> {
        const { issues } = inputs;
        const { env, logger, context } = options;
        
        logger.info("Performing code review");
        logger.info("Running static code analysis via linting...");

        // Log all types of issues for comprehensive analysis
        if (issues.runtimeErrors.length > 0) {
            logger.info(`Found ${issues.runtimeErrors.length} runtime errors: ${issues.runtimeErrors.map(e => e.message).join(', ')}`);
        }
        if (issues.staticAnalysis.lint.issues.length > 0) {
            logger.info(`Found ${issues.staticAnalysis.lint.issues.length} lint issues`);
        }
        if (issues.staticAnalysis.typecheck.issues.length > 0) {
            logger.info(`Found ${issues.staticAnalysis.typecheck.issues.length} typecheck issues`);
        }
        
        logger.info("Performing comprehensive codebase analysis for all issue types (runtime, logic, UI, state management, incomplete features)");

        // Get files context
        const filesContext = getFilesContext(context);

        const messages = [
            createSystemMessage(generalSystemPromptBuilder(SYSTEM_PROMPT, {
                query: context.query,
                blueprint: context.blueprint,
                templateDetails: context.templateDetails,
                dependencies: context.dependencies,
                forCodegen: true
            })),
            createUserMessage(userPromptFormatter(issues, filesContext)),
        ];

        try {
            const { object: reviewResult } = await executeInference({
                env: env,
                messages,
                schema: CodeReviewOutput,
                agentActionName: "codeReview",
                context: options.inferenceContext,
                reasoning_effort: issues.runtimeErrors.length || issues.staticAnalysis.lint.issues.length || issues.staticAnalysis.typecheck.issues.length > 0 ? undefined : 'low',
                // format: 'markdown'
            });

            if (!reviewResult) {
                throw new Error("Failed to get code review result");
            }
            return reviewResult;
        } catch (error) {
            logger.error("Error during code review:", error);
            throw error;
        }
    }
}

/**
 * Get files context for review
 */
function getFilesContext(context: GenerationContext): string {
    const files = context.allFiles;
    const filesObject = { files };

    return TemplateRegistry.markdown.serialize(
        filesObject,
        z.object({
            files: z.array(FileOutputSchema)
        })
    );
}