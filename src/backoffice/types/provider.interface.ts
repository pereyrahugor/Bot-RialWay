export interface BackofficeProvider {
    sendTemplate(phone: string, templateName: string, languageCode: string, components: any[]): Promise<any>;
    getTemplates(): Promise<any[]>;
    getLibraryTemplates?(): Promise<any[]>;
    createTemplate?(name: string, category: string, language: string, text: string, examples?: string[]): Promise<any>;
    updateConfig?(config: any): void;
    vendor?: any;
    globalVendorArgs?: { sock?: any; store?: any };
    qrCodeString?: string;
}

export interface BackofficeConfig {
    provider: BackofficeProvider;
    groupProvider?: BackofficeProvider;
    openaiMain?: any;
    upload?: any;
}
