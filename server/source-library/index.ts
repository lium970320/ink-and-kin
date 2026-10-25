import { createSourceLibraryService } from './service';
import { createSourceLibraryRepository } from './repository';
export const sourceLibraryService = createSourceLibraryService(createSourceLibraryRepository());
