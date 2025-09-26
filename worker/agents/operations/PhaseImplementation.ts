import { PhaseConceptType, FileOutputType, PhaseConceptSchema } from '../schemas';
import { IssueReport } from '../domain/values/IssueReport';
import { createUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { issuesPromptFormatter, PROMPT_UTILS, STRATEGIES } from '../prompts';
import { CodeGenerationStreamingState } from '../streaming-formats/base';
import { FileProcessing } from '../domain/pure/FileProcessing';
// import { RealtimeCodeFixer } from '../assistants/realtimeCodeFixer';
import { AgentOperation, getSystemPromptWithProjectContext, OperationOptions } from '../operations/common';
import { SCOFFormat, SCOFParsingState } from '../streaming-formats/scof';
import { TemplateRegistry } from '../inferutils/schemaFormatters';
import { IsRealtimeCodeFixerEnabled, RealtimeCodeFixer } from '../assistants/realtimeCodeFixer';
import { AGENT_CONFIG } from '../inferutils/config';

export interface PhaseImplementationInputs {
    phase: PhaseConceptType
    issues: IssueReport
    isFirstPhase: boolean
    shouldAutoFix: boolean
    fileGeneratingCallback: (filePath: string, filePurpose: string) => void
    fileChunkGeneratedCallback: (filePath: string, chunk: string, format: 'full_content' | 'unified_diff') => void
    fileClosedCallback: (file: FileOutputType, message: string) => void
}

export interface PhaseImplementationOutputs{
    // rawFiles: FileOutputType[]
    fixedFilePromises: Promise<FileOutputType>[]
    deploymentNeeded: boolean
    commands: string[]
}

export const SYSTEM_PROMPT = `<ROLE>
    You are an Expert Senior Full-Stack Engineer at Cloudflare, renowned for working on mission critical infrastructure and crafting high-performance, visually stunning, robust, and maintainable Django applications with HTMX-enhanced frontends and Django REST Framework APIs.
    You are working on our special team that takes pride in rapid development and delivery of exceptionally beautiful, high quality projects that users love to interact with.
    You have been tasked to build a project with obsessive attention to visual excellence based on specifications provided by our senior software architect.
</ROLE>

<GOAL>
    **Primary Objective:** Build fully functional, production-ready Django applications in phases following architect-designed specifications.
    
    **Implementation Process:**
    1. **ANALYZE** current codebase snapshot and identify what needs to be built across Django apps, templates, static assets, and APIs
    2. **PRIORITIZE** critical runtime errors that must be fixed first (template exceptions, migration failures, import errors)
    3. **IMPLEMENT** phase requirements following blueprint specifications exactly with exceptional focus on:
       - **Backend Reliability**: Django models, migrations, admin, DRF serializers/viewsets, and Celery/async tasks when relevant
       - **Visual Excellence**: Beautiful, modern UI rendered through Django templates/partials with mobile-first responsiveness
       - **Interactive Polish**: Smooth HTMX interactions, loading indicators, optimistic UI, and resilient fallbacks
       - **Responsive Perfection**: Flawless layouts across all device sizes
       - **User Experience**: Intuitive navigation, clear feedback, delightful interactions
    4. **VALIDATE** that implementation is deployable, error-free, AND visually stunning
    
    **Success Criteria:**
    - Application is demoable, deployable, AND visually impressive after this phase
    - Zero runtime errors or deployment-blocking issues
    - All phase requirements from architect are fully implemented
    - Code meets Cloudflare's highest standards for robustness, performance, AND visual excellence
    - Users are delighted by the interface design and smooth interactions
    - Every UI element demonstrates professional-grade visual polish
    
    **One-Shot Implementation:** You have only one attempt to implement this phase successfully. Quality and reliability are paramount.
</GOAL>

<CONTEXT>
    •   You MUST adhere to the <BLUEPRINT> and the <CURRENT_PHASE> provided to implement the current phase. It is your primary specification.
    •   The project was started based on our standard boilerplate template. It comes preconfigured with certain components preinstalled. 
    •   You will be provided with all of the current project code. Please go through it thoroughly, and understand it deeply before beginning your work. Use the components, utilities and APIs provided in the project.
    •   Due to security constraints, Only a fixed set of packages and dependencies are allowed for you to use which are preconfigured in the project and listed in <DEPENDENCIES>. Verify every import statement against them before using them.
    •   If you see any other dependency being referenced, Immediately correct it.
</CONTEXT>

<CLIENT REQUEST>
"{{query}}"
</CLIENT REQUEST>

<BLUEPRINT>
{{blueprint}}
</BLUEPRINT>

<DEPENDENCIES>
**Available Dependencies:**

Installed packages in the project:
{{dependencies}}

additional dependencies/frameworks **may** be provided:
{{blueprintDependencies}}

These are the only dependencies, components and plugins available for the project
</DEPENDENCIES>

${PROMPT_UTILS.UI_GUIDELINES}

We follow the following strategy at our team for rapidly delivering projects:
${STRATEGIES.FRONTEND_FIRST_CODING}

{{template}}`;

const USER_PROMPT = `**IMPLEMENT THE FOLLOWING PROJECT PHASE**
<CURRENT_PHASE>
{{phaseText}}
</CURRENT_PHASE>

<INSTRUCTIONS & CODE QUALITY STANDARDS>
These are the instructions and quality standards that must be followed to implement this phase.
**CRITICAL ERROR PREVENTION (Fix These First):**

    1. **Template Reliability** - HIGHEST PRIORITY
       - Resolve `TemplateDoesNotExist`, missing `{% extends %}` hierarchies, and undefined context variables
       - Ensure every HTMX partial renders safely with `{% csrf_token %}` and graceful fallback content
       - Validate that base layouts include navigation/footer via `{% block %}` inheritance, not duplicated markup

    2. **Database & Migration Safety** - CRITICAL
       - Keep models, serializers, and migrations synchronized
       - Generate and apply migrations when models change; avoid conflicting migration names
       - Default to safe field choices (nullability, defaults) to prevent runtime errors when migrating existing data

    3. **Routing & View Wiring** - DEPLOYMENT BLOCKER
       - Confirm every route in `urls.py` resolves to an importable view or DRF viewset
       - Use namespaced URL patterns for multi-tenant or multi-app setups
       - Ensure views return proper HttpResponse/JsonResponse objects with status codes and context dictionaries

    4. **API Contract Guarantees**
       - Build DRF serializers/viewsets that validate input, return typed responses, and expose schema docs when possible
       - Add pagination, filtering, and permission classes consistent with blueprint requirements
       - Provide clear error responses with actionable messages for frontend consumption

    5. **Preview & Asset Stability**
       - Configure static files and bundler manifests so templates load versioned CSS/JS using `{% static %}` or manifest helpers
       - Provide HTMX indicators (spinners, `hx-target` placeholders, error fallbacks) and display traceback overlays during preview mode
       - Ensure management commands or watcher scripts restart Django dev servers when files change

    **CODE QUALITY STANDARDS:**
    •   **Robustness:** Write fault-tolerant code with proper error handling, transaction safety, and CSRF protection.
    •   **Separation of Concerns:** Keep Django apps modular; isolate templates, static assets, serializers, and forms per domain.
    •   **Template Craftsmanship:** Use Django template inheritance, reusable `{% include %}` partials, HTMX fragments with loading/error states, and responsive layouts.
    •   **API Excellence:** Expose DRF endpoints that frontends (React or HTMX) can consume, with serializers, viewsets, routers, and tests.
    •   **Dependency Verification:** **ONLY** use libraries specified in <DEPENDENCIES>. No other libraries are allowed or exist.
    •   **Styling:** Use the specified CSS approach consistently (Tailwind utility classes, compiled CSS, or SCSS). Ensure classes exist in the generated stylesheet.
    •   **BUG FREE CODE:** Write high quality code of the highest standards. Ensure imports are valid, migrations run, templates render, and tests pass.
    •   **Static Assets:** Reference assets through `{% static %}` or manifest helpers. Keep bundler config simple and ensure output manifests are wired into templates.
    •   **Feedback & UX:** Always provide loading spinners, error banners, empty states, and optimistic feedback for HTMX requests and DRF API calls.
    •   **Accessibility & Responsiveness:** Deliver mobile-first templates with semantic markup, ARIA attributes, and accessible color contrast.
    •   **Observability:** Surface preview errors in-page overlays; log server issues with actionable messages.
    •   **Extensibility Hooks:** Prepare placeholders for ideation steps, plugin toggles (SEO, analytics, theming), and deployment/export commands without hard-coding vendor secrets.
    •   **Follow DRY principles:** Understand existing patterns before writing new code. Reuse template blocks, view mixins, serializer base classes, and helper utilities.
    •   **Safe Defaults:** Use environment variables for secrets, guard against injection, and validate external input aggressively.
    •   Ensure everything that is needed is exported correctly (e.g., urls, app configs, serializers). Keep module-level code import-safe.
    •   You may need to rewrite a file from a *previous* phase *if* you identify a critical issue or runtime errors in it.
    •   If any previous phase files were not made correctly or were corrupt, rewrite them in this phase. Guarantee the entire codebase is correct and working as expected.
    •   **Write the whole, raw contents for every file (`full_content` format). Do not use diff format.**
    •   **Every phase needs to be deployable with Django dev server and preview tooling running properly!**
    •   **If its the first phase, replace boilerplate placeholder pages with actual Django templates and URL/view wiring!**
    •   **Make sure the product after this phase is FUNCTIONAL, POLISHED, AND VISUALLY STUNNING**
        - **Frontend Visual Excellence:** Write template code with obsessive attention to visual details and responsive behavior
        - **Backend Logic Excellence:** Implement Django models, forms, serializers, and view logic with clear separation and validation
        - **Design System Consistency:** Maintain consistent visual patterns and component behaviors throughout partials and templates
        - Always stick to best design practices, DRY principles and SOLID principles while prioritizing user delight
    •   **ALWAYS document commands, environment variables, and preview endpoints that need to run for this phase.**


Also understand the following:

${PROMPT_UTILS.COMMON_PITFALLS}

</INSTRUCTIONS & CODE QUALITY STANDARDS>

Every single file listed in <CURRENT_PHASE> needs to be implemented in this phase, based on the provided <OUTPUT FORMAT>.

**CRITICAL IMPLEMENTATION RULES:**

⚠️  **DJANGO RUNTIME STABILITY** - ZERO TOLERANCE
- Do NOT ship code that triggers `TemplateDoesNotExist`, `ImproperlyConfigured`, or missing context variables
- Run through the URL map mentally to ensure every view/template pair resolves correctly
- When modifying models, include migrations and update admin/serializer registrations in the same phase

⚠️  **HTMX INTERACTION SAFETY**
- Every HTMX request must include loading indicators (`hx-indicator`) and error fallbacks (`hx-on::error`)
- Always scope updates with `hx-target`/`hx-swap` so partials do not replace unintended DOM sections
- Provide accessible fallback content for users without JavaScript

⚠️  **API CONTRACT GUARANTEES**
- Keep serializers, viewsets, and URLs consistent with documented schema; update tests or schema descriptions accordingly
- Return structured errors (detail, code) for failed requests and surface them in templates

⚠️  **ASSET & PREVIEW CONSISTENCY**
- Wire static assets via `{% static %}` or manifest helpers—never hardcode hashed filenames
- Document commands/env vars necessary to run the preview/dev servers
- Ensure watcher scripts restart the Django server or trigger template reloads after file changes

⚠️  **BACKWARD COMPATIBILITY** - PRESERVE EXISTING FUNCTIONALITY
- Do NOT break anything from previous phases
- Maintain all existing features and functionality
- Test mentally that previous phase flows (auth, forms, dashboards) still work
- We have frequent regressions - be extra cautious


${PROMPT_UTILS.COMMON_DEP_DOCUMENTATION}

{{issues}}

{{technicalInstructions}}`;

const LAST_PHASE_PROMPT = `Finalization and Review phase. 
Goal: Thoroughly review the entire codebase generated in previous phases. Identify and fix any remaining critical issues (runtime errors, logic flaws, rendering bugs) before deployment.
** YOU MUST HALT AFTER THIS PHASE **

<REVIEW FOCUS & METHODOLOGY>
    **Your primary goal is to find showstopper bugs and UI/UX problems. Prioritize:**
    1.  **Runtime Errors & Crashes:** Any code that will obviously throw errors (Syntax errors, TDZ/Initialization errors, TypeErrors like reading property of undefined, incorrect API calls). **Analyze the provided \`errors\` carefully for root causes.**
    2.  **Critical Logic Flaws:** Does the application logic *actually* implement the behavior described in the blueprint? (e.g., Simulate game moves mentally: Does moving left work? Does scoring update correctly? Are win/loss conditions accurate?).
    3.  **UI Rendering Failures:** Will the UI render as expected? Check for:
        * **Layout Issues:** Misalignment, Incorrect borders/padding/margins etc, overlapping elements, incorrect spacing/padding, broken responsiveness (test mentally against mobile/tablet/desktop descriptions in blueprint).
        * **Styling Errors:** Missing or incorrect CSS classes, incorrect framework usage (e.g., wrong Tailwind class).
        * **Missing Elements:** Are all UI elements described in the blueprint present?
    4.  **State Management Bugs:** Does state update correctly? Do UI updates reliably reflect state changes? Are there potential race conditions or infinite update loops?
    5.  **Data Flow & Integration Errors:** Is data passed correctly between components? Do component interactions work as expected? Are imports valid and do the imported files/functions exist?
    6.  **Event Handling:** Do buttons, forms, and other interactions trigger the correct logic specified in the blueprint?
    7. **Import/Dependency Issues:** Are all imports valid? Are there any missing or incorrectly referenced dependencies? Are they correct for the specific version installed?
    8. **Library version issues:** Are you sure the code written is compatible with the installed version of the library? (e.g., Tailwind v3 vs. v4)
    9. **Watch for Django template/view regressions**
        - Look for missing context data, incorrect `{% url %}` names, HTMX fragments that lack fallbacks, or DRF endpoints returning unexpected payloads.

    **Method:**
    •   Review app-by-app, considering its models, migrations, serializers, urls, views, templates, static assets, and management commands.
    •   Mentally simulate user flows described in the blueprint.
    •   Cross-reference implementation against the \`description\`, \`userFlow\`, \`components\`, \`dataFlow\`, and \`implementationDetails\` sections *constantly*.
    •   Pay *extreme* attention to declaration order within scopes.
    •   Check for any imports that are not defined, installed or are not in the template.
    •   Come up with a the most important and urgent issues to fix first. We will run code reviews in multiple iterations, so focus on the most important issues first.

    IF there are any runtime errors or linting errors provided, focus on fixing them first and foremost. No need to provide any minor fixes or improvements to the code. Just focus on fixing the errors.

</REVIEW FOCUS & METHODOLOGY>

<ISSUES TO REPORT (Answer these based on your review):>
    1.  **Functionality Mismatch:** Does the codebase *fail* to deliver any core functionality described in the blueprint? (Yes/No + Specific examples)
    2.  **Logic Errors:** Are there flaws in the application logic (state transitions, calculations, game rules, etc.) compared to the blueprint? (Yes/No + Specific examples)
    3.  **Interaction Failures:** Do user interactions (clicks, inputs) behave incorrectly based on blueprint requirements? (Yes/No + Specific examples)
    4.  **Data Flow Problems:** Is data not flowing correctly between components or managed incorrectly? (Yes/No + Specific examples)
    5.  **State Management Issues:** Does state management lead to incorrect application behavior or UI? (Yes/No + Specific examples)
    6.  **UI Rendering Bugs:** Are there specific rendering issues (layout, alignment, spacing, overlap, responsiveness)? (Yes/No + Specific examples of files/components and issues)
    7.  **Performance Bottlenecks:** Are there obvious performance issues (e.g., inefficient loops, excessive re-renders)? (Yes/No + Specific examples)
    8.  **UI/UX Quality:** Is the UI significantly different from the blueprint's description or generally poor/unusable (ignoring minor aesthetics)? (Yes/No + Specific examples)
    9.  **Runtime Error Potential:** Identify specific code sections highly likely to cause runtime errors (TDZ, undefined properties, bad imports, syntax errors etc.). (Yes/No + Specific examples)
    10. **Dependency/Import Issues:** Are there any invalid imports or usage of non-existent/uninstalled dependencies? (Yes/No + Specific examples)

    If issues pertain to just dependencies not being installed, please only suggest the necessary \`bun add\` commands to install them. Do not suggest file level fixes.
</ISSUES TO REPORT (Answer these based on your review):>

**Regeneration Rules:**
    - Only regenerate files with **critical issues** causing runtime errors, significant logic flaws, or major rendering failures.
    - **Exception:** Small UI/CSS files *can* be regenerated for styling/alignment fixes if needed.
    - Do **not** regenerate for minor formatting or non-critical stylistic preferences.
    - Do **not** make major refactors or architectural changes.

<INSTRUCTIONS>
    Do not spend much time on this phase. If you find any critical issues, just fix them and move on, we will have thorough code reviews in the next phases.
    Do not make major changes to the code. Just focus on fixing the critical issues and bugs.
</INSTRUCTIONS>

This phase prepares the code for final deployment.`;

const README_GENERATION_PROMPT = `<TASK>
Generate a comprehensive README.md file for this project based on the provided blueprint and template information.
The README should be professional, well-structured, and provide clear instructions for users and developers.
</TASK>

<INSTRUCTIONS>
- Create a professional README with proper markdown formatting
- Do not add any images or screenshots
- Include project title, description, and key features from the blueprint
- Add technology stack section based on the template dependencies
- Include setup/installation instructions using bun (not npm/yarn)
- Add usage examples and development instructions
- Include a deployment section with Cloudflare-specific instructions
- **IMPORTANT**: Add a \`[cloudflarebutton]\` placeholder near the top and another in the deployment section for the Cloudflare deploy button. Write the **EXACT** string except the backticks and DON'T enclose it in any other button or anything. We will replace it with https://deploy.workers.cloudflare.com/?url=\${repositoryUrl\} when the repository is created.
- Structure the content clearly with appropriate headers and sections
- Be concise but comprehensive - focus on essential information
- Use professional tone suitable for open source projects
</INSTRUCTIONS>

Generate the complete README.md content in markdown format. 
Do not provide any additional text or explanation. 
All your output will be directly saved in the README.md file. 
Do not provide and markdown fence \`\`\` \`\`\` around the content either! Just pure raw markdown content!`;

const specialPhasePromptOverrides: Record<string, string> = {
    "Finalization and Review": LAST_PHASE_PROMPT,
}

const userPropmtFormatter = (phaseConcept: PhaseConceptType, issues: IssueReport) => {
    const phaseText = TemplateRegistry.markdown.serialize(
        phaseConcept,
        PhaseConceptSchema
    );
    
    const prompt = PROMPT_UTILS.replaceTemplateVariables(specialPhasePromptOverrides[phaseConcept.name] || USER_PROMPT, {
        phaseText,
        issues: issuesPromptFormatter(issues)
    });
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class PhaseImplementationOperation extends AgentOperation<PhaseImplementationInputs, PhaseImplementationOutputs> {
    async execute(
        inputs: PhaseImplementationInputs,
        options: OperationOptions
    ): Promise<PhaseImplementationOutputs> {
        const { phase, issues } = inputs;
        const { env, logger, context } = options;
        
        logger.info(`Generating files for phase: ${phase.name}`, phase.description, "files:", phase.files.map(f => f.path));
    
        // Notify phase start
        const codeGenerationFormat = new SCOFFormat();
        // Build messages for generation
        const messages = getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, true);
        messages.push(createUserMessage(userPropmtFormatter(phase, issues) + codeGenerationFormat.formatInstructions()));
    
        // Initialize streaming state
        const streamingState: CodeGenerationStreamingState = {
            accumulator: '',
            completedFiles: new Map(),
            parsingState: {} as SCOFParsingState
        };
    
        const fixedFilePromises: Promise<FileOutputType>[] = [];

        let modelConfig = AGENT_CONFIG.phaseImplementation;
        if (inputs.isFirstPhase) {
            modelConfig = AGENT_CONFIG.firstPhaseImplementation;
        }

        const shouldEnableRealtimeCodeFixer = inputs.shouldAutoFix && IsRealtimeCodeFixerEnabled(options.inferenceContext);
    
        // Execute inference with streaming
        await executeInference({
            env: env,
            agentActionName: "phaseImplementation",
            context: options.inferenceContext,
            messages,
            modelConfig,
            stream: {
                chunk_size: 256,
                onChunk: (chunk: string) => {
                    codeGenerationFormat.parseStreamingChunks(
                        chunk,
                        streamingState,
                        // File generation started
                        (filePath: string) => {
                            logger.info(`Starting generation of file: ${filePath}`);
                            inputs.fileGeneratingCallback(filePath, FileProcessing.findFilePurpose(filePath, phase, context.allFiles.reduce((acc, f) => ({ ...acc, [f.filePath]: f }), {})));
                        },
                        // Stream file content chunks
                        (filePath: string, fileChunk: string, format: 'full_content' | 'unified_diff') => {
                            inputs.fileChunkGeneratedCallback(filePath, fileChunk, format);
                        },
                        // onFileClose callback
                        (filePath: string) => {
                            logger.info(`Completed generation of file: ${filePath}`);
                            const completedFile = streamingState.completedFiles.get(filePath);
                            if (!completedFile) {
                                logger.error(`Completed file not found: ${filePath}`);
                                return;
                            }
    
                            // Process the file contents
                            const originalContents = context.allFiles.find(f => f.filePath === filePath)?.fileContents || '';
                            completedFile.fileContents = FileProcessing.processGeneratedFileContents(
                                completedFile,
                                originalContents,
                                logger
                            );
    
                            const generatedFile: FileOutputType = {
                                ...completedFile,
                                filePurpose: FileProcessing.findFilePurpose(
                                    filePath, 
                                    phase, 
                                    context.allFiles.reduce((acc, f) => ({ ...acc, [f.filePath]: f }), {})
                                )
                            };

                            if (shouldEnableRealtimeCodeFixer && generatedFile.fileContents.split('\n').length > 50) {
                                // Call realtime code fixer immediately - this is the "realtime" aspect
                                const realtimeCodeFixer = new RealtimeCodeFixer(env, options.inferenceContext);
                                const fixPromise = realtimeCodeFixer.run(
                                    generatedFile, 
                                    {
                                        // previousFiles: previousFiles,
                                        query: context.query,
                                        template: context.templateDetails
                                    },
                                    phase
                                );
                                fixedFilePromises.push(fixPromise);
                            } else {
                                fixedFilePromises.push(Promise.resolve(generatedFile));
                            }
    
                            inputs.fileClosedCallback(generatedFile, `Completed generation of ${filePath}`);
                        }
                    );
                }
            }
        });

        // // Extract commands from the generated files
        // const commands = extractCommands(results.string, true);
        const commands = streamingState.parsingState.extractedInstallCommands;

        logger.info("Files generated for phase:", phase.name, "with", fixedFilePromises.length, "files being fixed in real-time and extracted install commands:", commands);
    
        // Return generated files for validation and deployment
        return {
            // rawFiles: generatedFilesInPhase,
            fixedFilePromises,
            deploymentNeeded: fixedFilePromises.length > 0,
            commands,
        };
    }

    async generateReadme(options: OperationOptions): Promise<FileOutputType> {
        const { env, logger, context } = options;
        logger.info("Generating README.md for the project");

        try {
            let readmePrompt = README_GENERATION_PROMPT;
            const messages = [...getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, true), createUserMessage(readmePrompt)];

            const results = await executeInference({
                env: env,
                messages,
                agentActionName: "projectSetup",
                context: options.inferenceContext,
            });

            if (!results || !results.string) {
                logger.error('Failed to generate README.md content');
                throw new Error('Failed to generate README.md content');
            }

            logger.info('Generated README.md content successfully');

            return {
                filePath: 'README.md',
                fileContents: results.string,
                filePurpose: 'Project documentation and setup instructions'
            };
        } catch (error) {
            logger.error("Error generating README:", error);
            throw error;
        }
    }
}
