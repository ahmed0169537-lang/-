import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CreateCommentDto, UpdateCommentDto, CommentQueryDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Comments')
@Controller('comments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  async createComment(
    @GetUser('id') userId: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(userId, createCommentDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get comment by ID' })
  @ApiResponse({ status: 200, description: 'Comment retrieved' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  async getComment(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.commentsService.getComment(id, userId);
  }

  @Get('post/:postId')
  @ApiOperation({ summary: 'Get all comments for a post' })
  @ApiResponse({ status: 200, description: 'Comments retrieved' })
  async getPostComments(
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() query: CommentQueryDto,
    @GetUser('id') userId: string,
  ) {
    return this.commentsService.getPostComments(postId, userId, query);
  }

  @Get(':id/replies')
  @ApiOperation({ summary: 'Get comment replies' })
  @ApiResponse({ status: 200, description: 'Replies retrieved' })
  async getCommentReplies(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.commentsService.getCommentReplies(id, page, limit);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a comment' })
  @ApiResponse({ status: 200, description: 'Comment updated successfully' })
  async updateComment(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.updateComment(id, userId, updateCommentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  async deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.commentsService.deleteComment(id, userId);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Like a comment' })
  @ApiResponse({ status: 200, description: 'Comment liked' })
  async likeComment(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.commentsService.likeComment(id, userId);
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Unlike a comment' })
  @ApiResponse({ status: 200, description: 'Comment unliked' })
  async unlikeComment(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.commentsService.unlikeComment(id, userId);
  }

  // Admin endpoints
  @Get('admin/reported')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get reported comments (Admin only)' })
  @ApiResponse({ status: 200, description: 'Reported comments retrieved' })
  async getReportedComments(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.commentsService.getReportedComments(page, limit);
  }

  @Delete('admin/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete comment by admin' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  async adminDeleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.commentsService.adminDeleteComment(id, reason);
  }
}
