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
  UploadedFiles,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import {
  CreatePostDto,
  UpdatePostDto,
  PostQueryDto,
} from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role, PostStatus } from '@prisma/client';

@ApiTags('Posts')
@Controller('posts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({ status: 201, description: 'Post created successfully' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('media', 10))
  async createPost(
    @GetUser('id') userId: string,
    @Body() createPostDto: CreatePostDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.postsService.createPost(userId, createPostDto, files);
  }

  @Get('feed')
  @ApiOperation({ summary: 'Get user feed' })
  @ApiResponse({ status: 200, description: 'Feed retrieved successfully' })
  async getFeed(
    @GetUser('id') userId: string,
    @Query() query: PostQueryDto,
  ) {
    return this.postsService.getFeed(userId, query);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Get trending posts' })
  @ApiResponse({ status: 200, description: 'Trending posts retrieved' })
  async getTrending(
    @Query('limit') limit: number = 20,
    @Query('timeframe') timeframe: string = '24h',
  ) {
    return this.postsService.getTrendingPosts(limit, timeframe);
  }

  @Get('explore')
  @ApiOperation({ summary: 'Explore posts' })
  @ApiResponse({ status: 200, description: 'Posts retrieved' })
  async explorePosts(
    @Query() query: PostQueryDto,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.explorePosts(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by ID' })
  @ApiResponse({ status: 200, description: 'Post retrieved' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getPost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.getPost(id, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a post' })
  @ApiResponse({ status: 200, description: 'Post updated successfully' })
  async updatePost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.updatePost(id, userId, updatePostDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a post' })
  @ApiResponse({ status: 200, description: 'Post deleted successfully' })
  async deletePost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.deletePost(id, userId);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Like a post' })
  @ApiResponse({ status: 200, description: 'Post liked' })
  async likePost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.likePost(id, userId);
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Unlike a post' })
  @ApiResponse({ status: 200, description: 'Post unliked' })
  async unlikePost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.unlikePost(id, userId);
  }

  @Post(':id/share')
  @ApiOperation({ summary: 'Share a post' })
  @ApiResponse({ status: 200, description: 'Post shared' })
  async sharePost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.sharePost(id, userId);
  }

  @Post(':id/pin')
  @ApiOperation({ summary: 'Pin a post' })
  @ApiResponse({ status: 200, description: 'Post pinned' })
  async pinPost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.pinPost(id, userId);
  }

  @Delete(':id/pin')
  @ApiOperation({ summary: 'Unpin a post' })
  @ApiResponse({ status: 200, description: 'Post unpinned' })
  async unpinPost(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') userId: string,
  ) {
    return this.postsService.unpinPost(id, userId);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get post comments' })
  @ApiResponse({ status: 200, description: 'Comments retrieved' })
  async getPostComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.postsService.getPostComments(id, page, limit);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user posts' })
  @ApiResponse({ status: 200, description: 'User posts retrieved' })
  async getUserPosts(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PostQueryDto,
    @GetUser('id') currentUserId: string,
  ) {
    return this.postsService.getUserPosts(userId, currentUserId, query);
  }

  @Get('hashtag/:tag')
  @ApiOperation({ summary: 'Get posts by hashtag' })
  @ApiResponse({ status: 200, description: 'Posts retrieved' })
  async getPostsByHashtag(
    @Param('tag') tag: string,
    @Query() query: PostQueryDto,
  ) {
    return this.postsService.getPostsByHashtag(tag, query);
  }

  // Admin endpoints
  @Get('admin/reported')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get reported posts (Admin only)' })
  @ApiResponse({ status: 200, description: 'Reported posts retrieved' })
  async getReportedPosts(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.postsService.getReportedPosts(page, limit);
  }

  @Put('admin/:id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update post status (Admin only)' })
  @ApiResponse({ status: 200, description: 'Post status updated' })
  async updatePostStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: PostStatus,
    @Body('reason') reason?: string,
  ) {
    return this.postsService.updatePostStatus(id, status, reason);
  }
}
