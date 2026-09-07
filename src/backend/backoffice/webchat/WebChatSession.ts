export class WebChatSession {
  [key: string]: any;
  public history: { role: string, content: string }[] = [];
  public thread_id: string | null = null;

  addUserMessage(msg: string) {
    if (!this.history.length || this.history[this.history.length - 1].content !== msg) {
      this.history.push({ role: 'user', content: msg });
    }
  }

  addAssistantMessage(msg: string) {
    if (!this.history.length || this.history[this.history.length - 1].content !== msg) {
      this.history.push({ role: 'assistant', content: msg });
    }
  }

  clear() {
    this.history = [];
    this.thread_id = null;
    delete this.awaitingApiKeyVerification;
    delete this.apiKeyVerificationRequestedAt;
    // Do not wipe other context keys to keep continuity of client info
  }
}
