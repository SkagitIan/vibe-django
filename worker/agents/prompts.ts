import { RuntimeError, RuntimeErrorSchema, StaticAnalysisResponse, TemplateDetails, TemplateFileSchema } from "../services/sandbox/sandboxTypes";
import { TemplateRegistry } from "./inferutils/schemaFormatters";
import z from 'zod';
import { Blueprint, BlueprintSchema, ClientReportedErrorSchema, ClientReportedErrorType, FileOutputType, PhaseConceptSchema, PhaseConceptType, TemplateSelection } from "./schemas";
import { IssueReport } from "./domain/values/IssueReport";
import { SCOFFormat } from "./streaming-formats/scof";
import { MAX_PHASES } from "./core/state";

export const PROMPT_UTILS = {
    /**
     * Replace template variables in a prompt string
     * @param template The template string with {{variable}} placeholders
     * @param variables Object with variable name -> value mappings
     */
    replaceTemplateVariables(template: string, variables: Record<string, string>): string {
        let result = template;
        
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{{${key}}}`;
            result = result.replaceAll(placeholder, value ?? '');
        }
        
        return result;
    },

    serializeTemplate(template?: TemplateDetails, forCodegen: boolean = true): string {
        if (template) {
            // const filesText = JSON.stringify(tpl.files, null, 2);
            const filesText = TemplateRegistry.markdown.serialize(
                { files: template.files.filter(f => !f.filePath.includes('package.json')) },
                z.object({ files: z.array(TemplateFileSchema) })
            );
            // const indentedFilesText = filesText.replace(/^(?=.)/gm, '\t\t\t\t'); // Indent each line with 4 spaces
            return `
<TEMPLATE DETAILS>
The following are the details (structures and files) of the starting boilerplate template, on which the project is based.

Name: ${template.name}
Frameworks: ${template.frameworks?.join(', ')}

${forCodegen ? `` : `
<TEMPLATE_CORE_FILES>
**SHADCN COMPONENTS, Error boundary components and use-toast hook ARE PRESENT AND INSTALLED BUT EXCLUDED FROM THESE FILES DUE TO CONTEXT SPAM**
${filesText}
</TEMPLATE_CORE_FILES>`}

<TEMPLATE_FILE_TREE>
**Use these files as a reference for the file structure, components and hooks that are present**
${JSON.stringify(template.fileTree, null, 2)}
</TEMPLATE_FILE_TREE>

Apart from these files, All SHADCN Components are present in ./src/components/ui/* and can be imported from there, example: import { Button } from "@/components/ui/button";
**Please do not rewrite these components, just import them and use them**

Template Usage Instructions: 
${template.description.usage}

<DO NOT TOUCH FILES>
These files are forbidden to be modified. Do not touch them under any circumstances.
${template.dontTouchFiles.join('\n')}
</DO NOT TOUCH FILES>

<REDACTED FILES>
These files are redacted. They exist but their contents are hidden for security reasons. Do not touch them under any circumstances.
${template.redactedFiles.join('\n')}
</REDACTED FILES>

**Websockets and dynamic imports are not supported, so please avoid using them.**

</TEMPLATE DETAILS>`;
        } else {
            return `
<START_FROM_SCRATCH>
No starter template is available—design the entire structure yourself. You need to write all the configuration files, package.json, and all the source code files from scratch.
You are allowed to install stuff. Be very careful with the versions of libraries and frameworks you choose.
For an example typescript vite project,
The project should support the following commands in package.json to run the application:
"scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types"
}
and provide a preview url for the application.

</START_FROM_SCRATCH>`;
        }
    },

    serializeErrors(errors: RuntimeError[]): string {
        if (errors && errors.length > 0) {
            const errorsSerialized = errors.map(e => {
                // Use rawOutput if available, otherwise serialize using schema
                const errorText = e.rawOutput || TemplateRegistry.markdown.serialize(e, RuntimeErrorSchema);
                // Truncate to 1000 characters to prevent context overflow
                return errorText.slice(0, 1000);
            });
            return errorsSerialized.join('\n\n');
        } else {
            return 'N/A';
        }
    },

    serializeStaticAnalysis(staticAnalysis: StaticAnalysisResponse): string {
        const lintOutput = staticAnalysis.lint?.rawOutput || 'No linting issues detected';
        const typecheckOutput = staticAnalysis.typecheck?.rawOutput || 'No type checking issues detected';
        
        return `**LINT ANALYSIS:**
${lintOutput}

**TYPE CHECK ANALYSIS:**
${typecheckOutput}`;
    },

    serializeClientReportedErrors(errors: ClientReportedErrorType[]): string {
        if (errors && errors.length > 0) {
            const errorsText = TemplateRegistry.markdown.serialize(
                { errors },
                z.object({ errors: z.array(ClientReportedErrorSchema) })
            );
            return errorsText;
        } else {
            return 'No client-reported errors';
        }
    },

    verifyPrompt(prompt: string): string {
        // If any of the '{{variables}}' are not replaced, throw an error
        // if (prompt.includes('{{')) {
        //     throw new Error(`Prompt contains un-replaced variables: ${prompt}`);
        // }
        return prompt;
    },

    serializeFiles(files: FileOutputType[]): string {
        // TemplateRegistry.markdown.serialize({ files: files }, z.object({ files: z.array(FileOutputSchema) }))
        // return files.map(file => {
        //     return `File: ${file.filePath}\nPurpose: ${file.filePurpose}\nContents: ${file.fileContents}`;
        // }).join('\n');
        // Use scof format
        return new SCOFFormat().serialize(files.map(file => {
            return {
                ...file,
                format: 'full_content'
            }
        }));
    },

    REACT_RENDER_LOOP_PREVENTION: `<REACT_RENDER_LOOP_PREVENTION>
Django crashes most often when templates, URLs, or database migrations fall out of sync. Treat this section as your playbook for keeping preview servers stable and developer feedback fast.

## The 3 Most Common Django Runtime Failures

### 1. **Missing Templates or Context Keys (MOST COMMON)**
Never reference a block, partial, or context variable that is not guaranteed to exist. Always inherit from a base layout and include fallbacks.

**Basic Pattern:**
```django
{# BAD CODE ❌ direct include without existence check #}
{% include "dashboard/widgets/stats-card.html" %}

{# GOOD CODE ✅ centralised partial with defaults #}
{% include "dashboard/widgets/stats-card.html" with stats=stats|default:empty_stats %}
```

**Context Guarding:**
```python
# BAD CODE ❌ missing key leads to TemplateDoesNotExist or KeyError
def dashboard(request):
    return render(request, "dashboard/index.html", {})

# GOOD CODE ✅ provide explicit context defaults
def dashboard(request):
    context = {
        "stats": get_stats() or [],
        "filters": FilterForm(request.GET or None),
    }
    return render(request, "dashboard/index.html", context)
```

**Base Layouts & Blocks:**
```django
{# BAD CODE ❌ duplicating nav/footer in every template #}
<html>... repeated nav ...</html>

{# GOOD CODE ✅ template inheritance keeps layout consistent #}
{% extends "core/layouts/base.html" %}
{% block content %}...{% endblock %}
```

### 2. **URL / View Import Errors**
Always keep `urls.py` wiring in sync with view definitions and namespaces.

```python
# BAD CODE ❌ missing import or wrong name
path("reports/", reports, name="reports")

# GOOD CODE ✅ explicit import + namespacing
from apps.reports.views import ReportListView
app_name = "reports"
urlpatterns = [
    path("", ReportListView.as_view(), name="list"),
]
```

### 3. **Migration & Serializer Drift**
Model changes require migrations, serializer updates, and admin registration in the same commit or phase.

```python
# BAD CODE ❌ adding field without defaults
class Project(models.Model):
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=20)  # NEW FIELD but no default

# GOOD CODE ✅ safe defaults + serializer alignment
class Project(models.Model):
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=ProjectStatus.choices, default=ProjectStatus.PLANNING)

class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ("id", "title", "status", "updated_at")
```

**Migration Checklist:**
- Generate migrations whenever models change (`python manage.py makemigrations`).
- Ensure migrations are idempotent and reversible.
- Run `python manage.py migrate` locally before marking the phase complete.

**Serializer/Admin Sync:**
- Update DRF serializers, admin, and forms to include new fields.
- Provide default values to avoid `IntegrityError` during migration.

## HTMX Safety Essentials
- Add `{% csrf_token %}` to every form or HTMX request.
- Provide `<div hx-indicator>` spinners and `hx-on::error` handlers that show user-friendly error banners.
- Scope updates with `hx-target` so partials do not clobber entire pages.

## Preview Diagnostics
- Wrap risky template regions with `{% if debug %}` overlays to surface stack traces in preview mode.
- Log server errors with structured context (view name, params) to speed up debugging.
- Document commands (`npm run dev`, `python manage.py runserver`, etc.) so preview containers can auto-restart.
</REACT_RENDER_LOOP_PREVENTION>`,

COMMON_PITFALLS: `<AVOID COMMON PITFALLS>
    **TOP 6 MISSION-CRITICAL RULES (FAILURE WILL CRASH THE APP):**
    1. **DEPENDENCY VALIDATION:** BEFORE writing any import statement, verify the package or module exists in <DEPENDENCIES> or the Django app registry. Install checks fail fast; avoid speculative imports.
    2. **URL & VIEW INTEGRITY:** Ensure every route declared in `urls.py` maps to a real view or DRF viewset. Namespaces (`app_name`) are required for multi-app projects.
    3. **MIGRATION HYGIENE:** Whenever models change, generate migrations, review them for safety, and apply them. Missing defaults or nullable fields will break deploys.
    4. **TEMPLATE SAFETY:** Never reference context variables that may be undefined. Use `{% include %}` with explicit context and always inherit from a base template to avoid duplicate layout code.
    5. **API CONTRACT GUARANTEE:** Keep serializers, viewsets, and schema definitions in sync. Return structured errors (detail, code) so HTMX/React clients can display friendly messages.
    6. **STATIC & BUNDLER CONSISTENCY:** Serve assets through `{% static %}` or manifest helpers. Do not hardcode hashed filenames; update bundler manifests when assets change.

    **UI/UX EXCELLENCE CRITICAL RULES:**
    7. **VISUAL HIERARCHY CLARITY:** Every template must express a clear hierarchy using headings, spacing, and typography.
    8. **INTERACTIVE FEEDBACK MANDATORY:** All forms and HTMX triggers must expose loading indicators, disabled states, and success/error banners.
    9. **RESPONSIVE BREAKPOINT INTEGRITY:** Design mobile-first, then enhance for tablet/desktop. Ensure grids/partials collapse gracefully.
    10. **SPACING CONSISTENCY:** Use design tokens or Tailwind spacing scale; avoid arbitrary pixel values that break rhythm.
    11. **LOADING STATE EXCELLENCE:** Provide skeletons/spinners for async DRF calls and HTMX swaps; never leave blank sections.
    12. **ERROR HANDLING GRACE:** Present user-friendly error summaries with remediation steps, not raw tracebacks (except in preview overlays).

    **ENHANCED RELIABILITY PATTERNS:**
    •   **Data Access:** Wrap ORM operations in transactions when performing multi-step writes. Handle DoesNotExist exceptions gracefully.
    •   **Type Safety:** Define Pydantic/TypedDict/Serializer classes for API responses. Validate external input before use.
    •   **Template Safety:** Use `{% empty %}` blocks, `default` filters, and guard loops with `{% if items %}` to avoid crashy pages.
    •   **Performance:** Prefetch related data, paginate large querysets, and cache expensive fragments cautiously.
    •   **Object Literals:** When returning JSON, ensure keys are unique and snake_case; avoid duplicate keys that clobber data.
    •   **Best Practices:** Reuse partials (`{% include %}`), view mixins, and serializer base classes to reduce duplication.

    **STATE & SESSION CONSIDERATIONS:**
    •   Use Django sessions sparingly; prefer explicit state persisted in the database or signed cookies.
    •   HTMX requests should return partials with deterministic DOM IDs to keep swapping predictable.

    **ALGORITHMIC PRECISION & LOGICAL REASONING:**
    •   Validate business rules in forms/serializers. Test edge cases (empty lists, invalid filters, timezone differences).
    •   Use descriptive variable names for loops (`row_index`, `column_index`) when rendering tables/calendars.

    **FRAMEWORK & SYNTAX SPECIFICS:**
    •   Respect Django settings (STATIC_URL, INSTALLED_APPS). Register new apps before referencing them.
    •   Keep management commands idempotent and guard against duplicate seed data.
    •   When bundling assets with Vite/Webpack, output a manifest JSON and load entries via a helper tag.
    •   Ensure Tailwind/PostCSS builds run in CI and include generated CSS in static files.

    **PROPER IMPORTS & MODULE STRUCTURE:**
       - Import views, serializers, and forms via explicit paths (`from apps.billing.views import InvoiceView`).
       - Keep `__init__.py` exports minimal; avoid circular imports by referencing modules directly.

    **CRITICAL SYNTAX ERRORS - PREVENT AT ALL COSTS:**
    1. **IMPORT SYNTAX:** Always use absolute app imports (`from apps.core import models`). Avoid relative imports that break when files move.
    2. **UNDEFINED VARIABLES:** Ensure context keys, serializer fields, and template tags exist before referencing them.

    **CRITICAL ERROR RECOVERY PATTERNS:**
    •   **API Call Safety:** Wrap external calls in try/except, return `Response({...}, status=...)` with helpful messages.
    •   **Template Rendering Safety:** Provide `{% else %}` fallbacks for loops and conditionals so the UI never disappears.
    •   **Form Handling Safety:** Validate forms with `form.is_valid()` before saving; return errors inline with helpful copy.

    **PRE-CODE VALIDATION CHECKLIST:**
    Before writing any code, mentally verify:
    - URLs/routes exist and map to the correct views
    - Migrations are generated/applied for model changes
    - Templates extend base layouts and include required blocks
    - Serializers/forms cover every field used in templates
    - Static assets referenced via `{% static %}` or manifest helper
    - External dependencies are available and configured

    **Also note there is no support for websockets and dynamic imports may not work, so please avoid using them.**

    ### **IMPORT VALIDATION EXAMPLES**
    **BAD IMPORTS** (cause runtime errors):
    ```python
    from .views import *                 # WRONG: pollutes namespace and hides missing views
    from django.urls import path, include # WRONG if include is unused; lint errors hide real issues
    from .models import Project           # WRONG if models live in another app
    ```

    **GOOD IMPORTS** (correct syntax):
    ```python
    from apps.projects.views import ProjectDashboardView
    from apps.projects.api import ProjectViewSet
    from django.urls import path
    ```

    **Import Checklist**:
    - ✅ Every Django app added to INSTALLED_APPS before use
    - ✅ URLs use namespaced patterns (`app_name = "projects"`)
    - ✅ Serializers/forms imported from explicit modules, not `*`

    **Never write image files! Never write jpeg, png, svg, etc files yourself! Always use some image url from the web.**
</AVOID COMMON PITFALLS>`
`,
    COMMON_DEP_DOCUMENTATION: `<COMMON DEPENDENCY DOCUMENTATION>
    • **Django & DRF:** Projects assume Django 5.x with Django REST Framework 3.15+. Use `from django.urls import path, include` and register DRF routers in `api_urls.py` to keep separation clean.
    • **HTMX:** Include `hx-headers='{"X-CSRFToken": "{{ csrf_token }}"}'` or rely on the global `htmx:config` script to attach CSRF tokens. Remember to add indicators via `hx-indicator` and handle errors with `hx-on::error`.
    • **Static Bundling:** If Vite/Webpack is installed, run the build to generate `manifest.json`. Load assets via a helper like `{% vite_asset "main.ts" %}` or by parsing the manifest.
    • **Tailwind/PostCSS:** Ensure `tailwind.config.js` paths include Django templates (e.g., `templates/**/*.html`). Regenerate CSS when templates change.
    • **Celery/Background Tasks:** When installed, configure broker URLs through environment variables. Provide fallback synchronous execution in development.
    • **No support for websockets and dynamic imports may not work, so please avoid using them.**
</COMMON DEPENDENCY DOCUMENTATION>`
`,
    COMMANDS: `<SETUP COMMANDS>
    • **Provide explicit commands to install necessary dependencies ONLY.** DO NOT SUGGEST MANUAL CHANGES. These commands execute directly.
    • **Dependency Versioning:**
        - **Use specific, known-good major versions.** Avoid relying solely on 'latest' (unless you are unsure) which can introduce unexpected breaking changes.
        - Always suggest a known recent compatible stable major version. If unsure which version might be available, don't specify any version.
        - Example: \`npm install react@18 react-dom@18\`
        - List commands to add dependencies separately, one command per dependency for clarity.
    • **Format:** Provide ONLY the raw command(s) without comments, explanations, or step numbers, in the form of a list
    • **Execution:** These run *before* code generation begins.

Example:
\`\`\`sh
bun add react@18
bun add react-dom@18
bun add zustand@4
bun add immer@9
bun add shadcn@2
bun add @geist-ui/react@1
\`\`\`
</SETUP COMMANDS>
`,
    CODE_CONTENT_FORMAT: `<CODE CONTENT GENERATION RULES> 
    The generated content for any file should be one of the following formats: \`full_content\` or \`unified_diff\`.

    - **When working on an existing (previously generated) file and the scope of changes would be smaller than a unified diff, use \`unified_diff\` format.**
    - **When writing an entirely new file, or the scope of changes would be bigger than a unified diff, use \`full_content\` format.**
    - **Do not use \`unified_diff\` for modifying untouched template files.**
    - **Make sure to choose the format so as to minimize the total length of response.**

    <RULES FOR \`full_content\`>
        • **Content Format:** Provide the complete and raw content of the file. Do not escape or wrap the content in any way.
        • **Example:**
            \`\`\`
                function myFunction() {
                    console.log('Hello, world!');
                }
            \`\`\`
    </RULES FOR \`full_content\`>

    <RULES FOR \`unified_diff\`>
        • **Content Format:** Provide the diff of the file. Do not escape or wrap the content in any way.
        • **Usage:** Use this format when working to modify an existing file and it would be smaller to represent the diff than the full content.
        
        **Diff Format Rules:**
            • Return edits similar to diffs that \`diff -U0\` would produce.
            • Do not include the first 2 lines with the file paths.
            • Start each hunk of changes with a \`@@ ... @@\` line.
            • Do not include line numbers like \`diff -U0\` does. The user's patch tool doesn't need them. The user's patch tool needs CORRECT patches that apply cleanly against the current contents of the file!
            • Think carefully and make sure you include and mark all lines that need to be removed or changed as \`-\` lines.
            • Make sure you mark all new or modified lines with \`+\`.
            • Don't leave out any lines or the diff patch won't apply correctly.
            • Indentation matters in the diffs!
            • Start a new hunk for each section of the file that needs changes.
            • Only output hunks that specify changes with \`+\` or \`-\` lines.
            • Skip any hunks that are entirely unchanging \` \` lines.
            • Output hunks in whatever order makes the most sense. Hunks don't need to be in any particular order.
            • When editing a function, method, loop, etc try to use a hunk to replace the *entire* code block. Delete the entire existing version with \`-\` lines and then add a new, updated version with \`+\` lines.  This will help you generate correct code and correct diffs.
            • To move code within a file, use 2 hunks: 1 to delete it from its current location, 1 to insert it in the new location.
        **Example:**

** Instead of low level diffs like this: **
\`\`\`
@@ ... @@
-def factorial(n):
+def factorial(number):
-    if n == 0:
+    if number == 0:
         return 1
     else:
-        return n * factorial(n-1)
+        return number * factorial(number-1)
\`\`\`

**Write high level diffs like this:**

\`\`\`
@@ ... @@
-def factorial(n):
-    if n == 0:
-        return 1
-    else:
-        return n * factorial(n-1)
+def factorial(number):
+    if number == 0:
+        return 1
+    else:
+        return number * factorial(number-1)
\`\`\`

    </RULES FOR \`unified_diff\`>

    When a changes to a file are big or the file itself is small, it is better to use \`full_content\` format, otherwise use \`unified_diff\` format. In the end, you should choose a format that minimizes the total length of response.
</CODE CONTENT GENERATION RULES>
`,
    UI_GUIDELINES: `## UI MASTERY & VISUAL EXCELLENCE STANDARDS
    
    ### 🎨 VISUAL HIERARCHY MASTERY
    • **Typography Excellence:** Create stunning text hierarchies:
        - Headlines: text-4xl/5xl/6xl with font-bold for maximum impact
        - Subheadings: text-2xl/3xl with font-semibold for clear structure  
        - Body: text-lg/base with font-medium for perfect readability
        - Captions: text-sm with font-normal for supporting details
        - **Color Psychology:** Use text-gray-900 for primary, text-gray-600 for secondary, text-gray-400 for tertiary
    • **Spacing Rhythm:** Create visual breathing room with harmonious spacing:
        - Section gaps: space-y-16 md:space-y-24 for major sections
        - Content blocks: space-y-6 md:space-y-8 for related content
        - Element spacing: space-y-3 md:space-y-4 for tight groupings
        - **Golden Ratio:** Use 8px base unit (space-2) multiplied by fibonacci numbers (1,1,2,3,5,8,13...)
    
    ### ✨ INTERACTIVE DESIGN EXCELLENCE
    • **Micro-Interactions:** Every interactive element must delight users:
        - **Hover States:** Subtle elevation (hover:shadow-lg), color shifts (hover:bg-blue-600), or scale (hover:scale-105)
        - **Focus States:** Beautiful ring outlines (focus:ring-2 focus:ring-blue-500 focus:ring-offset-2)
        - **Active States:** Pressed effects (active:scale-95) for tactile feedback
        - **Loading States:** Elegant spinners, skeleton screens, or pulse animations
        - **Transitions:** Smooth animations (transition-all duration-200 ease-in-out) for every state change
    • **Button Mastery:** Create buttons that users love to click:
        - **Primary:** Bold, vibrant colors (bg-blue-600 hover:bg-blue-700) with perfect contrast
        - **Secondary:** Subtle elegance (bg-gray-100 hover:bg-gray-200) with clear hierarchy
        - **Outline:** Clean borders (border-2 border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white)
        - **Danger:** Warning colors (bg-red-600 hover:bg-red-700) for destructive actions
    
    ### 🏗️ LAYOUT ARCHITECTURE EXCELLENCE
    • **Container Strategies:** Build layouts that feel intentional:
        - **Content Width:** Use max-w-7xl mx-auto for main containers
        - **Responsive Padding:** px-4 sm:px-6 lg:px-8 for perfect edge spacing
        - **Section Spacing:** py-16 md:py-24 lg:py-32 for generous vertical rhythm
    • **Grid Systems:** Create balanced, beautiful layouts:
        - **Product Grids:** grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 with gap-6 md:gap-8
        - **Feature Grids:** grid-cols-1 md:grid-cols-2 lg:grid-cols-3 with consistent aspect ratios
        - **Dashboard Grids:** Responsive grid-cols-12 with proper breakpoints for complex layouts
    • **Flexbox Mastery:** Perfect alignment and distribution:
        - **Navigation:** flex items-center justify-between for header layouts
        - **Cards:** flex flex-col justify-between for equal height card layouts
        - **Forms:** flex flex-col space-y-4 for clean form arrangements
    
    ### 🎯 COMPONENT DESIGN EXCELLENCE
    • **Card Components:** Design cards that stand out beautifully:
        - **Elevation:** Use shadow-sm, shadow-md, shadow-lg strategically for visual depth
        - **Borders:** Subtle border border-gray-200 or borderless with shadow for modern feel
        - **Padding:** p-6 md:p-8 for comfortable content spacing
        - **Hover Effects:** hover:shadow-xl hover:-translate-y-1 for delightful interactions
    • **Form Excellence:** Make forms a joy to use:
        - **Input States:** Beautiful focus rings, clear error states, success indicators
        - **Label Design:** font-medium text-gray-700 with proper spacing (mb-2)
        - **Error Handling:** text-red-600 text-sm with helpful, friendly messages
        - **Success Feedback:** text-green-600 with checkmark icons for validation
    • **Navigation Design:** Create intuitive, beautiful navigation:
        - **Active States:** Clear indicators with color, background, or underline
        - **Breadcrumbs:** Subtle text-gray-500 with proper separators
        - **Mobile Menu:** Smooth slide-in animations with backdrop blur
    
    ### 📱 RESPONSIVE DESIGN MASTERY
    • **Mobile-First Excellence:** Design for mobile, enhance for desktop:
        - **Touch Targets:** Minimum 44px touch targets for mobile usability
        - **Typography Scaling:** text-2xl md:text-4xl lg:text-5xl for responsive headers
        - **Image Handling:** aspect-w-16 aspect-h-9 for consistent image ratios
    • **Breakpoint Strategy:** Use Tailwind breakpoints meaningfully:
        - **sm (640px):** Tablet portrait adjustments
        - **md (768px):** Tablet landscape and small desktop
        - **lg (1024px):** Desktop layouts
        - **xl (1280px):** Large desktop enhancements
        - **2xl (1536px):** Ultra-wide optimizations
    
    ### 🌟 VISUAL POLISH CHECKLIST
    **Before completing any component, ensure:**
    - ✅ **Visual Rhythm:** Consistent spacing that creates natural reading flow
    - ✅ **Color Harmony:** Thoughtful color choices that support the brand and enhance usability
    - ✅ **Interactive Feedback:** Every clickable element responds beautifully to user interaction
    - ✅ **Loading Elegance:** Graceful loading states that maintain user engagement
    - ✅ **Error Grace:** Helpful, non-intimidating error messages with clear next steps
    - ✅ **Empty State Beauty:** Inspiring empty states that guide users toward their first success
    - ✅ **Accessibility Excellence:** Proper contrast ratios, keyboard navigation, screen reader support
    - ✅ **Performance Smooth:** 60fps animations and instant perceived load times`,
    PROJECT_CONTEXT: `Here is everything you will need for the project:

<PROJECT CONTEXT>

<COMPLETED PHASES>

The following phases have been completed and implemented:

{{phases}}

</COMPLETED PHASES>

<CODEBASE>

Here are all the relevant files in the current codebase:

{{files}}

**THESE DO NOT INCLUDE PREINSTALLED SHADCN COMPONENTS, REDACTED FOR SIMPLICITY. BUT THEY DO EXIST AND YOU CAN USE THEM.**

</CODEBASE>

{{commandsHistory}}

</PROJECT CONTEXT>
`,
}

export const STRATEGIES_UTILS = {
    INITIAL_PHASE_GUIDELINES: `**First Phase: Stunning Frontend Foundation & Visual Excellence**
        * **🎨 VISUAL DESIGN FOUNDATION:** Establish breathtaking visual foundation:
            - **Design System Excellence:** Define beautiful color palettes, typography scales, and spacing rhythms
            - **Component Library Mastery:** Leverage shadcn components to create stunning, cohesive interfaces
            - **Layout Architecture:** Build gorgeous navigation, headers, footers with perfect spacing and alignment
            - **Visual Identity:** Establish consistent branding elements that create emotional connection
        * **✨ UI COMPONENT EXCELLENCE:** Create components that users love to interact with:
            - **Interactive Polish:** Every button, form, and clickable element has beautiful hover states
            - **Micro-Interactions:** Subtle animations that provide delightful feedback
            - **State Management:** Loading, error, and empty states that maintain user engagement
            - **Responsive Mastery:** Components that look intentionally designed at every screen size
        * **🏗️ FRONTEND COMPLETION WITH VISUAL WOW FACTOR:** Build interfaces that impress:
            - **Primary Page Excellence:** Main page should be visually stunning and fully functional
            - **Secondary Page Polish:** All supporting pages with beautiful mockups and smooth navigation
            - **Zero Broken Links:** Every navigation element works perfectly - no 404s or dead ends
            - **Visual Hierarchy:** Clear information architecture that guides users naturally
            - **Content Strategy:** Thoughtful use of whitespace, typography, and visual elements
        * **🚀 CORE FUNCTIONALITY WITH STYLE:** Implement features that work beautifully:
            - **Feature Implementation:** Core application logic with elegant error handling
            - **Data Presentation:** Beautiful ways to display information that enhance comprehension
            - **User Workflows:** Smooth, intuitive user journeys with clear next steps
            - **Performance Excellence:** Fast, responsive interfaces that feel instant
        * **📱 RESPONSIVE & ACCESSIBLE EXCELLENCE:**
            - **Mobile-First Beauty:** Interfaces that shine on mobile and scale up gracefully
            - **Touch-Friendly Design:** Proper touch targets and gesture-friendly interactions
            - **Accessibility Excellence:** Beautiful interfaces that work for everyone
        * **🎯 COMPLETION STANDARDS:** Every element demonstrates professional-grade polish
            - **Visual Consistency:** Cohesive design language throughout all pages
            - **Interactive Feedback:** Every user action provides clear, beautiful feedback
            - **Error Handling Grace:** Helpful, friendly error messages that guide users forward
            - **Loading Elegance:** Beautiful loading states that maintain user engagement
        * **Phase Granularity:** For *simple* applications, deliver a complete, stunning product in one phase. For *complex* applications, establish a visually excellent foundation that impresses immediately.
        * **Deployable Milestone:** First phase should be immediately demoable with stunning visual appeal that makes stakeholders excited about the final product.
        * **Override template home page**: Be sure to rewrite the home page of the app. Do not remove the existing homepage, rewrite on top of it.`,
    SUBSEQUENT_PHASE_GUIDELINES: `**Subsequent Phases: Feature Excellence & Visual Refinement**
        * **🌟 ITERATIVE VISUAL EXCELLENCE:** Each phase elevates the user experience:
            - **Visual Polish Iteration:** Continuously refine spacing, colors, and interactions
            - **Animation Enhancement:** Add smooth transitions and delightful micro-interactions
            - **Component Refinement:** Improve existing components to professional-grade standards
            - **User Experience Optimization:** Streamline workflows and eliminate friction points
        * **🚀 FEATURE IMPLEMENTATION WITH STYLE:** Build functionality that users love:
            - **Complete Feature Development:** Every requested feature implemented with beautiful UI
            - **Workflow Optimization:** Smooth user journeys with intuitive navigation patterns
            - **Data Visualization Excellence:** Beautiful charts, tables, and information displays
            - **Interactive Feature Polish:** Forms, modals, and complex interactions that feel effortless
        * **🔗 BACKEND INTEGRATION EXCELLENCE:** Connect functionality with visual grace:
            - **Elegant Loading States:** Beautiful progress indicators and skeleton screens
            - **Error Handling Beauty:** Friendly error messages with helpful recovery actions
            - **Data State Management:** Graceful handling of empty, loading, and error states
            - **Performance Optimization:** Fast, responsive interfaces with smooth data transitions
        * **📈 SCALABLE ENHANCEMENT STRATEGY:** Build quality that scales:
            - **Component System Growth:** Expand design system with new, reusable components
            - **Pattern Library Development:** Establish consistent interaction patterns
            - **Visual Language Evolution:** Refine brand expression and visual identity
            - **User Experience Research:** Iterate based on usage patterns and feedback
        * **✨ CONTINUOUS UI/UX IMPROVEMENT:** Never settle for 'good enough':
            - **Visual Hierarchy Refinement:** Perfect information architecture and visual flow
            - **Interaction Design Polish:** Smooth, predictable, and delightful user interactions
            - **Responsive Design Excellence:** Flawless experience across all device sizes
            - **Accessibility Enhancement:** Beautiful interfaces that work for everyone
        * **🎯 CLIENT FEEDBACK INTEGRATION:** Rapid response to user needs:
            - **Priority Feature Development:** Address urgent client requests with visual excellence
            - **User Experience Optimization:** Refine workflows based on real user feedback
            - **Visual Preference Integration:** Adapt design elements to client brand preferences
            - **Performance Enhancement:** Optimize for speed while maintaining visual quality
        * **🏆 FINAL EXCELLENCE PHASE:** Deliver a product that exceeds expectations:
            - **Comprehensive Polish Review:** Every pixel perfect, every interaction smooth
            - **Performance Optimization:** Lightning-fast load times with beautiful interfaces
            - **Cross-Browser Excellence:** Perfect rendering across all modern browsers
            - **Quality Assurance:** Thorough testing of every feature and interaction
            - **Launch Readiness:** Production-ready code with comprehensive documentation`,
    CODING_GUIDELINES: `**Make sure the product is **FUNCTIONAL** along with **POLISHED**
    **MAKE SURE TO NOT BREAK THE APPLICATION in SUBSEQUENT PHASES. Always keep fallbacks and failsafes in place for any backend interactions. Look out for simple syntax errors and dependencies you use!**
    **The client needs to be provided with a good demoable application after each phase. The initial first phase is the most impressionable phase! Make sure it deploys and renders well.**
    **Make sure the primary (home) page is rendered correctly and as expected after each phase**
    **Make sure to overwrite the home page file**`,
    CONSTRAINTS: `<PHASE GENERATION CONSTRAINTS>
        **Focus on building the frontend and all the views/pages in the initial 1-2 phases with core functionality and mostly mock data, then fleshing out the application**    
        **Before writing any components of your own, make sure to check the existing components and files in the template, try to use them if possible (for example preinstalled shadcn components)**
        **If auth functionality is required, provide mock auth functionality primarily. Provide real auth functionality ONLY IF template has persistence layer. Remember to seed the persistence layer with mock data AND Always PREFILL the UI with mock credentials. No oauth needed**

        **Applications with single view/page or mostly static content are considered **Simple Projects** and those with multiple views/pages are considered **Complex Projects** and should be designed accordingly.**
        * **Phase Count:** Aim for a maximum of 1 phase for simple applications and 3-7 phases for complex applications. Each phase should be self-contained. Do not exceed more than ${Math.floor(MAX_PHASES * 0.8)} phases unless addressing complex client feedbacks.
        * **File Count:** Aim for a maximum of 1-3 files per phase for simple applications and 8-12 files per phase for complex applications.
        * The number of files in the project should be proportional to the number of views/pages that the project has.
        * Keep the size of codebase as small as possible, write encapsulated and abstracted code that can be reused, maximize code and component reuse and modularity. If a function/component is to be used in multiple files, it should be defined in a shared file.
        **DO NOT WRITE/MODIFY README FILES, LICENSES, ESSENTIAL CONFIG, OR OTHER NON-APPLICATION FILES as they are already configured in the final deployment. You are allowed to modify tailwind.config.js, vite.config.js etc if necessary**
            - Be very careful while working on vite.config.js, tailwind.config.js, etc. as any wrong changes can break the application.
        **DO NOT WRITE pdf files, images, or any other non-text files as they are not supported by the deployment.**

        **Examples**:
            * Building any tic-tac-toe game: Has a single page, simple logic -> **Simple Project** - 1 phase and 1-2 files. Initial phase should yield a perfectly working game.        
            * Building any themed 2048 game: Has a single page, simple logic -> **Simple Project** - 1 phase and 2 files max. Initial phase should yield a perfectly working game.
            * Building a full chess platform: Has multiple pages -> **Complex Project** - 3-5 phases and 5-15 files, with initial phase having around 5-11 files and should have the primary homepage working with mockups for all other views.
            * Building a full e-commerce platform: Has multiple pages -> **Complex Project** - 3-5 phases and 5-15 files max, with initial phase having around 5-11 files and should have the primary homepage working with mockups for all other views.
    </PHASE GENERATION CONSTRAINTS>`,
}

export const STRATEGIES = {
    FRONTEND_FIRST_PLANNING: `<PHASES GENERATION STRATEGY>
    **STRATEGY: Scalable, Demoable Frontend and core application First / Iterative Feature Addition later**
    The project would be developed live: The user (client) would be provided a preview link after each phase. This is our rapid development and delivery paradigm.
    The core principle is to establish a visually complete and polished frontend presentation early on with core functionalities implemented, before layering in more advanced functionality and fleshing out the backend.
    The goal is to build and demo a functional and beautiful product as fast and as early as possible.
    **Each phase should be self-contained, deployable and demoable.**
    The number of phases and files per phase should scale based on the number of views/pages and complexity of the application, layed out as follows:

    ${STRATEGIES_UTILS.INITIAL_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.SUBSEQUENT_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.CONSTRAINTS}

    **No need to add accessibility features. Focus on delivering an actually feature-wise polished and complete application in as few phases as possible.**
    **Always stick to existing project/template patterns. Respect and work with existing worker bindings rather than making custom ones**
    **Rely on open source tools and free tier services only apart from whats configured in the environment. Refer to template usage instructions to know if specific cloudflare services are also available for use.**
    **Make sure to implement all the features and functionality requested by the user and more. The application should be fully complete by the end of the last phase. There should be no compromises**
    **This is a Cloudflare Workers & Durable Objects project. The environment is preconfigured. Absolutely DO NOT Propose changes to wrangler.toml or any other config files. These config files are hidden from you but they do exist.**
    **The Homepage of the frontend is a dummy page. It should be rewritten as the primary page of the application in the initial phase.**
    **Refrain from editing any of the 'dont touch' files in the project, e.g - package.json, vite.config.ts, wrangler.jsonc, etc.**
</PHASES GENERATION STRATEGY>`, 
FRONTEND_FIRST_CODING: `<PHASES GENERATION STRATEGY>
    **STRATEGY: Scalable, Demoable Frontend and core application First / Iterative Feature Addition later**
    The project would be developed live: The user (client) would be provided a preview link after each phase. This is our rapid development and delivery paradigm.
    The core principle is to establish a visually complete and polished frontend presentation early on with core functionalities implemented, before layering in more advanced functionality and fleshing out the backend.
    The goal is to build and demo a functional and beautiful product as fast and as early as possible.
    **Each phase should be self-contained, deployable and demoable**

    ${STRATEGIES_UTILS.INITIAL_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.SUBSEQUENT_PHASE_GUIDELINES}

    ${STRATEGIES_UTILS.CODING_GUIDELINES}

    **Make sure to implement all the features and functionality requested by the user and more. The application should be fully complete by the end of the last phase. There should be no compromises**
</PHASES GENERATION STRATEGY>`, 
}

export interface GeneralSystemPromptBuilderParams {
    query: string,
    templateDetails: TemplateDetails,
    dependencies: Record<string, string>,
    forCodegen: boolean,
    blueprint?: Blueprint,
    language?: string,
    frameworks?: string[],
    templateMetaInfo?: TemplateSelection,
}

export function generalSystemPromptBuilder(
    prompt: string,
    params: GeneralSystemPromptBuilderParams
): string {
    // Base variables always present
    const variables: Record<string, string> = {
        query: params.query,
        template: PROMPT_UTILS.serializeTemplate(params.templateDetails, params.forCodegen),
        dependencies: JSON.stringify(params.dependencies || [])
    };

    // Optional blueprint variables
    if (params.blueprint) {
        variables.blueprint = TemplateRegistry.markdown.serialize(params.blueprint, BlueprintSchema);
        variables.blueprintDependencies = params.blueprint.frameworks.join(', ');
    }

    // Optional language and frameworks
    if (params.language) {
        variables.language = params.language;
    }
    if (params.frameworks) {
        variables.frameworks = params.frameworks.join(', ');
    }
    if (params.templateMetaInfo) {
        variables.usecaseSpecificInstructions = getUsecaseSpecificInstructions(params.templateMetaInfo);
    }

    const formattedPrompt = PROMPT_UTILS.replaceTemplateVariables(prompt, variables);
    return PROMPT_UTILS.verifyPrompt(formattedPrompt);
}

export function issuesPromptFormatter(issues: IssueReport): string {
    const runtimeErrorsText = issues.runtimeErrors.map((error) => `<error>${error.rawOutput}</error>`).join('\n');
    const staticAnalysisText = PROMPT_UTILS.serializeStaticAnalysis(issues.staticAnalysis);
    
    return `## ERROR ANALYSIS PRIORITY MATRIX

### 1. CRITICAL RUNTIME ERRORS (Fix First - Deployment Blockers)
**Error Count:** ${issues.runtimeErrors?.length || 0} runtime errors detected
**Contains Render Loops:** ${runtimeErrorsText.includes('Maximum update depth') || runtimeErrorsText.includes('Too many re-renders') ? 'YES - HIGHEST PRIORITY' : 'No'}

${runtimeErrorsText || 'No runtime errors detected'}

### 2. STATIC ANALYSIS ISSUES (Fix After Runtime Issues)
**Lint Issues:** ${issues.staticAnalysis?.lint?.issues?.length || 0}
**Type Issues:** ${issues.staticAnalysis?.typecheck?.issues?.length || 0}

${staticAnalysisText}

## ANALYSIS INSTRUCTIONS
- **PRIORITIZE** "Maximum update depth exceeded" and useEffect-related errors  
- **CROSS-REFERENCE** error messages with current code structure (line numbers may be outdated)
- **VALIDATE** reported issues against actual code patterns before fixing
- **FOCUS** on deployment-blocking runtime errors over linting issues`
}


export const USER_PROMPT_FORMATTER = {
    PROJECT_CONTEXT: (phases: PhaseConceptType[], files: FileOutputType[], commandsHistory: string[]) => {
        const variables: Record<string, string> = {
            phases: TemplateRegistry.markdown.serialize({ phases: phases }, z.object({ phases: z.array(PhaseConceptSchema) })),
            files: PROMPT_UTILS.serializeFiles(files),
            commandsHistory: commandsHistory.length > 0 ? `<COMMANDS HISTORY>

The following commands have been executed successfully in the project environment so far (These may not include the ones that are currently pending):

${commandsHistory.join('\n')}

</COMMANDS HISTORY>` : ''
        };

        const prompt = PROMPT_UTILS.replaceTemplateVariables(PROMPT_UTILS.PROJECT_CONTEXT, variables);
        
        return PROMPT_UTILS.verifyPrompt(prompt);
    },
};

const getStyleInstructions = (style: TemplateSelection['styleSelection']): string => {
    switch (style) {
        case `Brutalism`:
            return `
**Style Name: Brutalism**
- Characteristics: Raw aesthetics, often with bold vibrant colors on light background, large typography, large elements.
- Philosophy: Emphasizes honesty and simplicity, Non-grid, asymmetrical layouts that ignore traditional design hierarchy.
- Example Elements: Large, blocky layouts, heavy use of whitespace, unconventional navigation patterns.
`;
        case 'Retro':
            return `
**Style Name: Retro**
- Characteristics: Early-Internet graphics, pixel art, 3D objects, or glitch effects.
- Philosophy: Nostalgia-driven, aiming to evoke the look and feel of 90s or early 2000s web culture.
- Example Elements: Neon palettes, grainy textures, gradient meshes, and quirky fonts.`;
        case 'Illustrative':
            return `
**Style Name: Illustrative**
- Characteristics: Custom illustrations, sketchy graphics, and playful elements
- Philosophy: Human-centered, whimsical, and expressive.
- Example Elements: Cartoon-style characters, brushstroke fonts, animated SVGs.
- Heading Font options: Playfair Display, Fredericka the Great, Great Vibes
            `
//         case 'Neumorphism':
//             return `
// **Style Name: Neumorphism (Soft UI)**
// - Use a soft pastel background, high-contrast accent colors for functional elements e.g. navy, coral, or bright blue. Avoid monochrome UIs
// - Light shadow (top-left) and dark shadow (bottom-right) to simulate extrusion or embedding, Keep shadows subtle but visible to prevent a washed-out look.
// - Avoid excessive transparency in text — keep readability high.
// - Integrate glassmorphism subtly`;
        case `Kid_Playful`:
            return `
**Style Name: Kid Playful**
- Bright, contrasting colors
- Stylized illustrations resembling 2D animation or children's book art
- Smooth, rounded shapes and clean borders—no gradients or realism
- Similar to Pablo Stanley, Burnt Toast Creative, or Outline-style art.
- Children’s book meets modern web`
        case 'Minimalist Design':
            return `
**Style Name: Minimalist Design**
Characteristics: Clean layouts, lots of white space, limited color palettes, and simple typography.
Philosophy: "Less is more." Focuses on clarity and usability.
Example Elements: Monochrome schemes, subtle animations, grid-based layouts.
** Apply a gradient background or subtle textures to the hero section for depth and warmth.
`
    }
    return `
** Apply a gradient background or subtle textures to the hero section for depth and warmth.
** Choose a modern sans-serif font like Inter, Sora, or DM Sans
** Use visual contrast: white or light background, or very soft gradient + clean black text.
    `
};

const SAAS_LANDING_INSTRUCTIONS = (style: TemplateSelection['styleSelection']): string => `
** If there is no brand/product name specified, come up with a suitable name
** Include a prominent hero section with a headline, subheadline, and a clear call-to-action (CTA) button above the fold.
** Insert a pricing table with tiered plans if applicable
** Design a footer with key navigation links, company info, social icons, and a newsletter sign-up.
** Add a product feature section using icon-text pairs or cards to showcase 3-6 key benefits.
** Use a clean, modern layout with generous white space and a clear visual hierarchy
** Show the magic live i.e if possible show a small demo of the product. Only if simple and feasible.
** Generate SVG illustrations where absolutely relevant.

Use the following artistic style:
${getStyleInstructions(style)}
`;

const ECOMM_INSTRUCTIONS = (): string => `
** If there is no brand/product name specified, come up with a suitable name
** Include a prominent hero section with a headline, subheadline, and a clear call-to-action (CTA) button above the fold.
** Insert a product showcase section with high-quality images, descriptions, and prices.
** Provide a collapsible sidebar (desktop) or an expandable top bar (tablet/mobile) containing filters (category, price range slider, brand, color swatches), so users can refine results without leaving the page.
** Use a clean, modern layout with generous white space and a clear visual hierarchy
`;

const DASHBOARD_INSTRUCTIONS = (): string => `
** If applicable to user query group Related Controls and Forms into Well-Labeled Cards / Panels
** If applicable to user query offer Quick Actions / Shortcuts for Common Tasks
** If user asked for analytics/visualizations/statistics - Show sparklines, mini line/bar charts, or simple pie indicators for trends 
** If user asked for analytics/visualizations/statistics - Maybe show key metrics in modular cards
** If applicable to user query make It Interactive and Contextual (Filters, Search, Pagination)
** If applicable to user query add a sidebar and or tabs
** Dashboard should be information dense.
`;

export const getUsecaseSpecificInstructions = (selectedTemplate: TemplateSelection): string => {
    switch (selectedTemplate.useCase) {
        case 'SaaS Product Website':
            return SAAS_LANDING_INSTRUCTIONS(selectedTemplate.styleSelection);
        case 'E-Commerce':
            return ECOMM_INSTRUCTIONS();
        case 'Dashboard':
            return DASHBOARD_INSTRUCTIONS();
        default:
            return `Use the following artistic style:
            ${getStyleInstructions(selectedTemplate.styleSelection)}`;
    }
}
