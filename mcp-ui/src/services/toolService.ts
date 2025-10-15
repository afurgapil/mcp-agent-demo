import { callTool } from "./api";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class ToolService {
  private static instance: ToolService;

  public static getInstance(): ToolService {
    if (!ToolService.instance) {
      ToolService.instance = new ToolService();
    }
    return ToolService.instance;
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<ToolResult> {
    try {
      console.log(`Executing tool: ${toolName} with args:`, args);
      const result = await callTool(toolName, args);
      console.log(`Tool ${toolName} result:`, result);
      return {
        success: true,
        data: (result as { result?: unknown }).result ?? (result as unknown),
      };
    } catch (error) {
      console.error(`Tool ${toolName} failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Database tools
  async getTables(): Promise<ToolResult> {
    return this.executeTool("postgres_show_tables");
  }

  async describeTable(tableName: string): Promise<ToolResult> {
    return this.executeTool("postgres_describe_table", { table: tableName });
  }

  async executeSql(sql: string): Promise<ToolResult> {
    return this.executeTool("postgres_execute_sql", { sql });
  }

  async getTableData(
    tableName: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ToolResult> {
    return this.executeTool("postgres_list_table_limited", {
      tableName,
      limit,
      offset,
    });
  }

  async pingDatabase(): Promise<ToolResult> {
    return this.executeTool("ping_postgres");
  }
}

export const toolService = ToolService.getInstance();
