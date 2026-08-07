import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UploadedFile,
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
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import {
  UpdateProfileDto,
  UpdatePrivacyDto,
  UserSearchDto,
} from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully' })
  async getCurrentUser(@GetUser('id') userId: string) {
    return this.usersService.getUserProfile(userId);
  }

  @Put('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  async updateProfile(
    @GetUser('id') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Put('me/privacy')
  @ApiOperation({ summary: 'Update user privacy settings' })
  @ApiResponse({ status: 200, description: 'Privacy settings updated' })
  async updatePrivacy(
    @GetUser('id') userId: string,
    @Body() updatePrivacyDto: UpdatePrivacyDto,
  ) {
    return this.usersService.updatePrivacy(userId, updatePrivacyDto);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload user avatar' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(
    @GetUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.updateAvatar(userId, file);
  }

  @Post('me/cover')
  @ApiOperation({ summary: 'Upload user cover image' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('cover'))
  async uploadCover(
    @GetUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.updateCover(userId, file);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user profile by ID' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.usersService.getUserProfile(id, currentUserId);
  }

  @Get()
  @ApiOperation({ summary: 'Search users' })
  @ApiResponse({ status: 200, description: 'Users retrieved' })
  async searchUsers(
    @Query() searchDto: UserSearchDto,
    @GetUser('id') currentUserId: string,
  ) {
    return this.usersService.searchUsers(searchDto, currentUserId);
  }

  @Get(':id/followers')
  @ApiOperation({ summary: 'Get user followers' })
  @ApiResponse({ status: 200, description: 'Followers retrieved' })
  async getFollowers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.usersService.getFollowers(id, page, limit);
  }

  @Get(':id/following')
  @ApiOperation({ summary: 'Get users followed by user' })
  @ApiResponse({ status: 200, description: 'Following list retrieved' })
  async getFollowing(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.usersService.getFollowing(id, page, limit);
  }

  @Post(':id/follow')
  @ApiOperation({ summary: 'Follow a user' })
  @ApiResponse({ status: 200, description: 'User followed successfully' })
  async followUser(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.usersService.followUser(currentUserId, targetUserId);
  }

  @Delete(':id/follow')
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiResponse({ status: 200, description: 'User unfollowed successfully' })
  async unfollowUser(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.usersService.unfollowUser(currentUserId, targetUserId);
  }

  @Get(':id/follow-status')
  @ApiOperation({ summary: 'Check follow status' })
  @ApiResponse({ status: 200, description: 'Follow status retrieved' })
  async getFollowStatus(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @GetUser('id') currentUserId: string,
  ) {
    return this.usersService.getFollowStatus(currentUserId, targetUserId);
  }

  @Get('me/suggestions')
  @ApiOperation({ summary: 'Get user suggestions' })
  @ApiResponse({ status: 200, description: 'Suggestions retrieved' })
  async getUserSuggestions(
    @GetUser('id') userId: string,
    @Query('limit') limit: number = 10,
  ) {
    return this.usersService.getUserSuggestions(userId, limit);
  }

  @Delete('me')
  @ApiOperation({ summary: 'Delete user account' })
  @ApiResponse({ status: 200, description: 'Account deleted successfully' })
  async deleteAccount(
    @GetUser('id') userId: string,
    @Body('password') password: string,
  ) {
    return this.usersService.deleteAccount(userId, password);
  }

  // Admin endpoints
  @Get('admin/all')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all users (Admin only)' })
  @ApiResponse({ status: 200, description: 'Users retrieved' })
  async getAllUsers(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
    @Query('search') search?: string,
  ) {
    return this.usersService.getAllUsers(page, limit, search);
  }

  @Put('admin/:id/ban')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Ban a user (Admin only)' })
  @ApiResponse({ status: 200, description: 'User banned successfully' })
  async banUser(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body('reason') reason: string,
  ) {
    return this.usersService.banUser(userId, reason);
  }

  @Put('admin/:id/unban')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Unban a user (Admin only)' })
  @ApiResponse({ status: 200, description: 'User unbanned successfully' })
  async unbanUser(@Param('id', ParseUUIDPipe) userId: string) {
    return this.usersService.unbanUser(userId);
  }

  @Put('admin/:id/role')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Change user role (Super Admin only)' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  async changeRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body('role') role: Role,
  ) {
    return this.usersService.changeRole(userId, role);
  }
}
