/**
 * Ambient types for the Feishu SDK.
 *
 * The SDK is an optional dependency: it is only needed when someone actually
 * connects a Feishu channel. It is loaded dynamically so that an install
 * without it still starts and still works on every other channel.
 *
 * The declarations below cover only the parts Mirrai uses.
 */
declare module "@larksuiteoapi/node-sdk" {
  export interface FeishuClient {
    im: {
      v1: {
        message: {
          create(params: {
            params: { receive_id_type: string };
            data: {
              receive_id: string;
              msg_type: string;
              content: string;
            };
          }): Promise<unknown>;
        };
      };
    };
  }

  export interface FeishuEventDispatcher {
    register(handlers: Record<string, (data: any) => unknown>): FeishuEventDispatcher;
  }

  export interface FeishuWSClient {
    start(config: { eventDispatcher: FeishuEventDispatcher }): void;
    close?(): void;
  }

  export class Client {
    constructor(config: {
      appId: string;
      appSecret: string;
      appType?: unknown;
      domain?: unknown;
    });
    im: FeishuClient["im"];
  }

  // SDK 1.76.0 要求传入选项对象；这里只声明本适配器可能使用的基础选项。
  export interface FeishuEventDispatcherOptions {
    verificationToken?: string;
    encryptKey?: string;
  }

  export class EventDispatcher {
    constructor(options: FeishuEventDispatcherOptions);
    register(handlers: Record<string, (data: any) => unknown>): FeishuEventDispatcher;
  }

  export class WSClient {
    constructor(config: { appId: string; appSecret: string });
    start(config: { eventDispatcher: FeishuEventDispatcher }): void;
    close?(): void;
  }

  export const AppType: { SelfBuild: unknown; ISV: unknown };
  export const Domain: { Feishu: unknown; Lark: unknown };
}
