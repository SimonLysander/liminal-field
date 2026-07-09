import { IsString } from 'class-validator';

export class CreateLearningProjectDto {
  @IsString()
  rootNodeId!: string;
}
