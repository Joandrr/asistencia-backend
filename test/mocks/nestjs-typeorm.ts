export const InjectRepository = () => () => {};
export const TypeOrmModule = {
  forFeature: () => ({ module: class {} }),
  forRoot: () => ({ module: class {} }),
  forRootAsync: () => ({ module: class {} }),
};
