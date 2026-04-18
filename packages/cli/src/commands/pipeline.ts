import { apiFetch } from '../client/api.js';

interface PipelineInfo {
  id: string;
  name: string;
  status: string;
  currentStepIndex: number;
  steps: Array<{ id: string; agentType: string; projectPath: string }>;
}

export async function pipelineCommand(sub: string, args: string[]): Promise<void> {
  switch (sub) {
    case 'ls':
    case 'list':
      await pipelineList();
      break;
    case 'create':
      await pipelineCreate(args);
      break;
    case 'run':
      await pipelineRun(args[0]);
      break;
    default:
      console.log(`Usage: flowwhips pipeline <ls|create|run>`);
  }
}

async function pipelineList(): Promise<void> {
  try {
    const pipelines = await apiFetch<PipelineInfo[]>('/api/pipelines');
    if (pipelines.length === 0) {
      console.log('No pipelines.');
      return;
    }
    for (const p of pipelines) {
      console.log(
        `${p.id.slice(0, 8)}  ${p.name.padEnd(20)} ${p.status}  (${p.steps.length} steps)`,
      );
    }
  } catch {
    console.error('Failed to connect to daemon.');
  }
}

async function pipelineCreate(args: string[]): Promise<void> {
  const nameIdx = args.indexOf('--name');
  const name = nameIdx >= 0 ? args[nameIdx + 1] : 'unnamed';
  const stepsIdx = args.indexOf('--steps');
  const stepsJson = stepsIdx >= 0 ? args[stepsIdx + 1] : undefined;

  if (!stepsJson) {
    console.error(
      'Usage: flowwhips pipeline create --name "review-fix" --steps \'[{"id":"s1","agentType":"claude-code","projectPath":"/path"}]\'',
    );
    process.exit(1);
  }

  try {
    const steps = JSON.parse(stepsJson);
    const pipeline = await apiFetch<PipelineInfo>('/api/pipelines', {
      method: 'POST',
      body: JSON.stringify({ name, steps }),
    });
    console.log(`Pipeline created: ${pipeline.id} (${pipeline.name})`);
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function pipelineRun(id?: string): Promise<void> {
  if (!id) {
    console.error('Usage: flowwhips pipeline run <pipeline-id>');
    process.exit(1);
  }
  try {
    await apiFetch<{ status: string }>(`/api/pipelines/${id}/run`, { method: 'POST' });
    console.log(`Pipeline ${id} running.`);
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  }
}
