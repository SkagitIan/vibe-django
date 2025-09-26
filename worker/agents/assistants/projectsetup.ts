import { TemplateDetails } from "../../services/sandbox/sandboxTypes";
import { SetupCommandsType, type Blueprint } from "../schemas";
import { createObjectLogger, StructuredLogger } from '../../logger';
import { generalSystemPromptBuilder, PROMPT_UTILS } from '../prompts';
import { createAssistantMessage, createSystemMessage, createUserMessage } from "../inferutils/common";
import { executeInference, } from "../inferutils/infer";
import Assistant from "./assistant";
import { AIModels, InferenceContext } from "../inferutils/config.types";
import { extractCommands } from "../utils/common";

interface GenerateSetupCommandsArgs {
    env: Env;
    agentId: string;
    query: string;
    blueprint: Blueprint;
    template: TemplateDetails;
    inferenceContext: InferenceContext;
}

const SYSTEM_PROMPT = `You are an Expert DevOps Engineer supporting DigitalOcean-hosted Django deployments. Your specialty is analyzing blueprints and generating precise Python dependency installation commands (pip/Poetry) so teams can configure virtual environments quickly.`

const SETUP_USER_PROMPT = `## TASK
Analyze the blueprint and generate exact \`pip install\` (or \`poetry add\`) commands for missing Python dependencies. Only suggest packages that are NOT already in the starting template.

## EXAMPLES

**Example 1 - Account Portal:**
Blueprint mentions: "User onboarding with social login"
Starting template has: Django, DRF, TailwindCSS
Output:
\`\`\`bash
pip install "django-allauth>=0.61"
pip install "django-axes>=6.1"
\`\`\`

**Example 2 - Dashboard with Charts:**
Blueprint mentions: "Analytics dashboard with interactive charts"
Starting template has: Django, DRF
Output:
\`\`\`bash
pip install "django-filter>=23.5"
pip install "drf-spectacular>=0.27"
pip install "django-htmx>=1.17"
\`\`\`

**Example 3 - Already Complete:**
Blueprint mentions: "Simple todo app"
Starting template has: Django, DRF, HTMX, TailwindCSS
Output:
\`\`\`bash
# No additional dependencies needed
\`\`\`

## RULES
- Use ONLY \`pip install <package>[extras]==<version>\` or \`poetry add <package>==<version>\` commands
- Prefer pip install commands targeting the latest stable major release compatible with Django 4.2/5.x
- Ensure commands can run inside a virtual environment (`python -m venv .venv && source .venv/bin/activate`)
- Skip dependencies already present in the starting template
- Include common companion packages when needed (e.g., celery + redis, pillow for image uploads, whitenoise for static files)
- Focus on blueprint requirements only and mention system-level notes if DigitalOcean Droplets require apt packages (postgresql-client, build-essential)

${PROMPT_UTILS.COMMANDS}

<INPUT DATA>
<QUERY>
{{query}}
</QUERY>

<BLUEPRINT>
{{blueprint}}
</BLUEPRINT>

<STARTING TEMPLATE>
{{template}}

These are the only dependencies installed currently
{{dependencies}}
</STARTING TEMPLATE>

You need to make sure **ALL THESE** are installed at the least:
{{blueprintDependencies}}

</INPUT DATA>`;

export class ProjectSetupAssistant extends Assistant<Env> {
    private query: string;
    private logger: StructuredLogger;
    
    constructor({
        env,
        inferenceContext,
        query,
        blueprint,
        template,
    }: GenerateSetupCommandsArgs) {
        const systemPrompt = createSystemMessage(SYSTEM_PROMPT);
        super(env, inferenceContext, systemPrompt);
        this.save([createUserMessage(generalSystemPromptBuilder(SETUP_USER_PROMPT, {
            query,
            blueprint,
            templateDetails: template,
            dependencies: template.deps,
            forCodegen: false
        }))]);
        this.query = query;
        this.logger = createObjectLogger(this, 'ProjectSetupAssistant')
    }

    async generateSetupCommands(error?: string): Promise<SetupCommandsType> {
        this.logger.info("Generating setup commands", { query: this.query, queryLength: this.query.length });
    
        try {
            let userPrompt = createUserMessage(`Now please suggest required setup commands for the project, inside markdown code fence`);
            if (error) {
                this.logger.info(`Regenerating setup commands after error: ${error}`);
                userPrompt = createUserMessage(`Some of the previous commands you generated might not have worked. Please review these and generate new commands if required, maybe try a different version or correct the name?
                    
${error}`);
                this.logger.info(`Regenerating setup commands with new prompt: ${userPrompt.content}`);
            }
            const messages = this.save([userPrompt]);

            const results = await executeInference({
                env: this.env,
                messages,
                agentActionName: "projectSetup",
                context: this.inferenceContext,
                modelName: error? AIModels.GEMINI_2_5_FLASH : undefined,
            });
            if (!results || typeof results !== 'string') {
                this.logger.info(`Failed to generate setup commands, results: ${results}`);
                return { commands: [] };
            }

            this.logger.info(`Generated setup commands: ${results}`);

            this.save([createAssistantMessage(results)]);
            return { commands: extractCommands(results) };
        } catch (error) {
            this.logger.error("Error generating setup commands:", error);
            throw error;
        }
    }
}