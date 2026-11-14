// hirejuniors-jobs — hosts IngestWorkflow. No HTTP surface this phase.
import { IngestWorkflow } from "./workflow";

export { IngestWorkflow };

export default {
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
