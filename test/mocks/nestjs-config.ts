export class ConfigService {
  get<T = string>(key: string): T | undefined {
    return (process.env[key] as unknown as T) ?? undefined;
  }
  getOrThrow<T = string>(key: string): T {
    const val = process.env[key];
    if (val === undefined) throw new Error(`Missing ${key}`);
    return val as unknown as T;
  }
}

export class ConfigModule {
  static forRoot() {
    return { module: ConfigModule };
  }
}
