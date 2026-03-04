/**
 * notifier.ts — Alert Dispatcher
 *
 * Sends notifications to the human operator at different priority levels.
 * MVP: Console output only.
 * Phase 3: WhatsApp and Telegram integration.
 *
 * Priority Levels:
 *   INFO             — Routine status updates (logged only)
 *   APPROVAL_NEEDED  — Human must approve before proceeding
 *   CRITICAL         — System failure or circuit breaker tripped
 */

export type NotificationPriority = "INFO" | "APPROVAL_NEEDED" | "CRITICAL";

export interface Notification {
    priority: NotificationPriority;
    message: string;
    taskId?: string;
    connector?: string;
    timestamp: string;
    requiresResponse: boolean;
}

export interface NotifierConfig {
    consoleEnabled?: boolean;
    // Phase 3 additions:
    // whatsappWebhookUrl?: string;
    // telegramBotToken?: string;
    // telegramChatId?: string;
}

export class Notifier {
    private config: NotifierConfig;
    private history: Notification[] = [];

    constructor(config: NotifierConfig = {}) {
        this.config = {
            consoleEnabled: true,
            ...config,
        };
    }

    /**
     * Send a notification to the human operator.
     */
    async send(
        message: string,
        priority: NotificationPriority,
        options: { taskId?: string; connector?: string } = {}
    ): Promise<Notification> {
        const notification: Notification = {
            priority,
            message,
            taskId: options.taskId,
            connector: options.connector,
            timestamp: new Date().toISOString(),
            requiresResponse: priority === "APPROVAL_NEEDED",
        };

        this.history.push(notification);

        // --- Console channel (MVP) ---
        if (this.config.consoleEnabled) {
            this.sendToConsole(notification);
        }

        // --- WhatsApp channel (Phase 3) ---
        // if (this.config.whatsappWebhookUrl) {
        //   await this.sendToWhatsApp(notification);
        // }

        // --- Telegram channel (Phase 3) ---
        // if (this.config.telegramBotToken && this.config.telegramChatId) {
        //   await this.sendToTelegram(notification);
        // }

        return notification;
    }

    /** Convenience: send INFO notification */
    async info(message: string, options?: { taskId?: string; connector?: string }): Promise<void> {
        await this.send(message, "INFO", options);
    }

    /** Convenience: send APPROVAL_NEEDED notification */
    async requestApproval(
        message: string,
        options?: { taskId?: string; connector?: string }
    ): Promise<void> {
        await this.send(message, "APPROVAL_NEEDED", options);
    }

    /** Convenience: send CRITICAL notification */
    async critical(
        message: string,
        options?: { taskId?: string; connector?: string }
    ): Promise<void> {
        await this.send(message, "CRITICAL", options);
    }

    /** Get notification history */
    getHistory(): Notification[] {
        return [...this.history];
    }

    /** Get pending approvals */
    getPendingApprovals(): Notification[] {
        return this.history.filter((n) => n.requiresResponse);
    }

    private sendToConsole(notification: Notification): void {
        const icon =
            notification.priority === "CRITICAL"
                ? "🔴"
                : notification.priority === "APPROVAL_NEEDED"
                    ? "🟡"
                    : "🔵";

        const prefix = `${icon} [${notification.priority}]`;
        const taskInfo = notification.taskId ? ` (task: ${notification.taskId})` : "";
        const connectorInfo = notification.connector ? ` [${notification.connector}]` : "";

        console.log(`${prefix}${taskInfo}${connectorInfo} ${notification.message}`);
    }

    // Phase 3 stubs:
    // private async sendToWhatsApp(notification: Notification): Promise<void> { ... }
    // private async sendToTelegram(notification: Notification): Promise<void> { ... }
}
