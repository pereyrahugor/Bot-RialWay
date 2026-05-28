import "dotenv/config";

const RAILWAY_GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";

// Las variables se obtienen dinámicamente para soportar Hot-update desde DB
const getRailwayConfig = () => ({
  token: process.env.RAILWAY_TOKEN,
  projectId: process.env.RAILWAY_PROJECT_ID,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
  serviceId: process.env.RAILWAY_SERVICE_ID,
});

interface DeploymentNode {
  id: string;
  staticUrl?: string;
  createdAt?: string;
  status?: string;
}

interface DeploymentResponse {
  data?: {
    deployments?: {
      edges?: Array<{ node: DeploymentNode }>;
    };
  };
  errors?: Array<{ message: string; traceId?: string }>;
}

export class RailwayApi {
  /**
   * Helper privado para realizar peticiones fetch y validar la respuesta JSON
   */
  private static async fetchRailway(query: string, variables: any): Promise<any> {
    const config = getRailwayConfig();
    if (!config.token) {
      throw new Error("No se puede realizar la petición a Railway: RAILWAY_TOKEN no configurado.");
    }
    const body = JSON.stringify({ query, variables });

    const res = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.token}`,
      },
      body,
    });

    const contentType = res.headers.get("content-type");
    const isJson = contentType && contentType.includes("application/json");

    if (!res.ok) {
      const text = await res.text();
      console.error(`[RailwayApi] HTTP Error ${res.status}: ${res.statusText}`);
      console.error(`[RailwayApi] Response body (first 200 chars): ${text.substring(0, 200)}`);
      throw new Error(`Railway API respondió con status ${res.status}: ${res.statusText}`);
    }

    if (!isJson) {
      const text = await res.text();
      console.error(`[RailwayApi] Error: Respuesta no es JSON. Content-Type: ${contentType}`);
      console.error(`[RailwayApi] Response body (first 200 chars): ${text.substring(0, 200)}`);
      throw new Error("Railway API no devolvió una respuesta JSON válida.");
    }

    return await res.json();
  }

  /**
   * Obtiene el ID del deployment activo de un proyecto Railway
   */
  static async getActiveDeploymentId(): Promise<string | null> {
    const query = `
      query deployments(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!
      ) {
        deployments(
          first: 1,
          input: {
            projectId: $projectId,
            environmentId: $environmentId,
            serviceId: $serviceId
          }
        ) {
          edges {
            node {
              id
              staticUrl
              createdAt
              status
            }
          }
        }
      }
    `;

    const config = getRailwayConfig();
    const variables = {
      projectId: config.projectId,
      environmentId: config.environmentId,
      serviceId: config.serviceId,
    };

    try {
      console.log("[RailwayApi] Request getActiveDeploymentId...");
      const data: DeploymentResponse = await this.fetchRailway(query, variables);
      // console.log("[RailwayApi] Response getActiveDeploymentId:", JSON.stringify(data, null, 2));

      if (data.errors?.length) {
        console.error("Error desde Railway API:", data.errors);
        return null;
      }

      const deployment = data?.data?.deployments?.edges?.[0]?.node;
      if (!deployment?.id) {
        console.error("No se encontró ningún deployment activo.");
        return null;
      }

      console.log("[RailwayApi] Deployment activo encontrado:", deployment.id);
      return deployment.id;
    } catch (err: any) {
      console.error("[RailwayApi] Error en getActiveDeploymentId:", err.message);
      return null;
    }
  }

  /**
   * Obtiene las variables de entorno del servicio en Railway
   */
  static async getVariables(): Promise<Record<string, string> | null> {
    const query = `
      query variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }
    `;

    const config = getRailwayConfig();
    const variables = {
      projectId: config.projectId,
      environmentId: config.environmentId,
      serviceId: config.serviceId,
    };

    try {
      const data = await this.fetchRailway(query, variables);
      if (data.errors?.length) {
        console.error("[RailwayApi] Error obteniendo variables:", data.errors);
        return null;
      }

      const allVariables = data?.data?.variables || {};
      // Filtrar para no exponer variables internas de Railway al frontend
      const filteredVariables: Record<string, string> = {};
      Object.keys(allVariables).forEach(key => {
        if (!key.startsWith('RAILWAY_')) {
          filteredVariables[key] = allVariables[key];
        }
      });

      return filteredVariables;
    } catch (err: any) {
      console.error("[RailwayApi] Error en getVariables:", err.message);
      return null;
    }
  }

  /**
   * Actualiza las variables de entorno en Railway de forma masiva para generar un solo deploy
   */
  static async updateVariables(newVariables: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    const filteredVariables: Record<string, string> = {};
    const keys = Object.keys(newVariables).filter(key => {
      if (!key.startsWith('RAILWAY_')) {
        filteredVariables[key] = newVariables[key];
        return true;
      }
      return false;
    });

    if (keys.length === 0) return { success: true };

    const mutation = `
      mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `;

    const config = getRailwayConfig();
    const variables = {
      input: {
        projectId: config.projectId,
        environmentId: config.environmentId,
        serviceId: config.serviceId,
        variables: filteredVariables
      }
    };

    try {
      const data = await this.fetchRailway(mutation, variables);
      if (data.errors?.length) {
        console.error("[RailwayApi] Error en mutation masiva:", JSON.stringify(data.errors, null, 2));
        const errorMsg = data.errors.map((e: any) => e.message).join("; ");
        return { success: false, error: errorMsg };
      }

      return { success: true };
    } catch (err: any) {
      console.error("[RailwayApi] Error en updateVariables masivo:", err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Reinicia el deployment activo de Railway
   */
  static async restartActiveDeployment(): Promise<{ success: boolean; error?: string }> {
    try {
      const deploymentId = await this.getActiveDeploymentId();
      if (!deploymentId) {
        return { success: false, error: "No se encontró deployment activo para el proyecto." };
      }

      console.log("[RailwayApi] Reiniciando deployment:", deploymentId);

      const mutation = `
        mutation deploymentRestart($id: String!) {
          deploymentRestart(id: $id)
        }
      `;

      const variables = { id: deploymentId };

      const data = await this.fetchRailway(mutation, variables);
      // console.log("[RailwayApi] Response restartActiveDeployment:", JSON.stringify(data, null, 2));

      if (data.errors?.length) {
        const errorMsg = data.errors.map((e: any) => e.message).join("; ");
        return { success: false, error: errorMsg };
      }

      return { success: true };
    } catch (err: any) {
      console.error("[RailwayApi] Error reiniciando deployment:", err.message);
      return { success: false, error: err.message };
    }
  }

  //   /**
  //    * Registra un dominio personalizado en el servicio de Railway de forma programática.
  //    * Utilizado para asignar urls tipo 'clientex.clientesneurolinks.com' automáticamente.
  //    */
  //   static async createCustomDomain(domainName: string): Promise<{ success: boolean; data?: any; error?: string }> {
  //     const mutation = `
  //       mutation customDomainCreate($input: CustomDomainCreateInput!) {
  //         customDomainCreate(input: $input) {
  //           id
  //           domain
  //           status {
  //             verificationToken
  //             dnsRecords {
  //               type
  //               name
  //               value
  //             }
  //           }
  //         }
  //       }
  //     `;

  //     const config = getRailwayConfig();
  //     const variables = {
  //       input: {
  //         projectId: config.projectId,
  //         environmentId: config.environmentId,
  //         serviceId: config.serviceId,
  //         domain: domainName,
  //       }
  //     };

  //     try {
  //       console.log(`[RailwayApi] Registrando dominio personalizado: ${domainName}...`);
  //       const res = await this.fetchRailway(mutation, variables);

  //       if (res.errors?.length) {
  //         console.error("[RailwayApi] Error registrando dominio:", res.errors);
  //         const errorMsg = res.errors.map((e: any) => e.message).join("; ");
  //         return { success: false, error: errorMsg };
  //       }

  //       return { success: true, data: res.data?.customDomainCreate };
  //     } catch (err: any) {
  //       console.error("[RailwayApi] Error en createCustomDomain:", err.message);
  //       return { success: false, error: err.message };
  //     }
  //   }
}


