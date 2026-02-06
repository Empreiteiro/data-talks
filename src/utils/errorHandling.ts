
/** Translates API/backend errors into user-friendly messages. */
export const translateApiError = (error: any): string => {
  if (!error?.message) return 'Erro desconhecido';

  const message = error.message;

  // Erros do Google Sheets - mensagens mais amigáveis
  if (message.includes('Acesso negado') || message.includes('compartilhada com a conta de serviço')) {
    return message; // Já está formatada corretamente
  }

  if (message.includes('Planilha não encontrada')) {
    return 'Planilha do Google Sheets não encontrada. Verifique se o link está correto e se a planilha não foi excluída.';
  }

  if (message.includes('Formato de ID de planilha inválido')) {
    return 'Link da planilha inválido. Copie o link completo da planilha do Google Sheets.';
  }

  if (message.includes('aba da planilha está vazia')) {
    return message;
  }

  // Erros de limite do plano
  if (message.includes('Limite do plano atingido')) {
    return message.replace('% fonte(s)', 'fontes').replace('% agente(s)', 'agentes');
  }

  if (message.includes('Limite mensal de perguntas atingido')) {
    return message.replace('% perguntas/mês', 'perguntas por mês');
  }

  // Outros erros comuns
  if (message.includes('duplicate key value violates unique constraint')) {
    return 'Este item já existe. Tente um nome diferente.';
  }

  if (message.includes('violates foreign key constraint')) {
    return 'Erro de referência. Verifique se todos os dados necessários estão disponíveis.';
  }

  if (message.includes('permission denied')) {
    return 'Você não tem permissão para realizar esta ação.';
  }

  // Retorna a mensagem original se não encontrar uma tradução
  return message;
};
