import { evaluate } from 'mathjs';

/**
 * Handler genérico para tool/function calls de OpenAI
 * Permite agregar fácilmente más funciones por nombre
 */
export function handleToolFunctionCall(toolCall: { name: string, parameters: any }) {
  const { name, parameters } = toolCall;
  switch (name) {
    case 'calcular_formula_generica': {
      const { formula, values, promos } = parameters;
      // Validación estricta de propiedades en values y promos
      if (typeof values !== 'object' || Array.isArray(values)) {
        return { error: 'El campo "values" debe ser un objeto con propiedades estrictas.' };
      }
      if (promos && (typeof promos !== 'object' || Array.isArray(promos))) {
        return { error: 'El campo "promos" debe ser un objeto con propiedades estrictas.' };
      }
      // Evaluar fórmula
      let result;
      try {
        result = evaluate(formula, values);
      } catch (err: any) {
        return { error: 'Error al evaluar la fórmula', detalles: err.message };
      }
      // Si hay promos, aplicar lógica aquí (placeholder, implementar según reglas)
      return {
        resultado: result,
        detalles: { formula, values, promos }
      };
    }
    // Agrega más cases para otras funciones personalizadas
    default:
      return { error: `Función no soportada: ${name}` };
  }
}
