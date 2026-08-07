import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { S3Service } from '../../common/services/s3.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostDto, UpdatePostDto, PostQueryDto } from './dto';
import { PostStatus, ContentType, PrivacyLevel } from '@prisma/client';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private s3: S3Service,
    private notificationsService: NotificationsService,
  ) {}

  async createPost(userId: string, createPostDto: CreatePostDto, files: Express.Multer.File[]) {
    const { content, hashtags, mentions, location, isPublic } = createPostDto;

    // Process media files
    const mediaUrls = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const url = await this.s3.uploadFile(file, `posts/${userId}`);
        mediaUrls.push(url);
      }
    }

    // Determine content type
    let contentType = ContentType.TEXT;
    if (mediaUrls.length > 0) {
      const mimeType = files[0].mimetype;
      if (mimeType.startsWith('image/')) {
        contentType = ContentType.IMAGE;
      } else if (mimeType.startsWith('video/')) {
        contentType = ContentType.VIDEO;
      }
    }

    // Extract hashtags from content if not provided
    let finalHashtags = hashtags || [];
    if (content && !hashtags) {
      const hashtagRegex = /#[\w\u0600-\u06FF]+/g;
      const matches = content.match(hashtagRegex);
      if (matches) {
        finalHashtags = matches.map(tag => tag.slice(1));
      }
    }

    // Extract mentions from content if not provided
    let finalMentions = mentions || [];
    if (content && !mentions) {
      const mentionRegex = /@[\w\u0600-\u06FF]+/g;
      const matches = content.match(mentionRegex);
      if (matches) {
        finalMentions = matches.map(mention => mention.slice(1));
      }
    }

    const post = await this.prisma.post.create({
      data: {
        userId,
        content,
        type: contentType,
        mediaUrls,
        hashtags: finalHashtags,
        mentions: finalMentions,
        location,
        isPublic: isPublic !== undefined ? isPublic : true,
        status: PostStatus.PUBLISHED,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Create notifications for mentions
    if (finalMentions.length > 0) {
      const mentionedUsers = await this.prisma.user.findMany({
        where: {
          username: {
            in: finalMentions,
          },
        },
        select: { id: true },
      });

      for (const user of mentionedUsers) {
        await this.notificationsService.createNotification({
          userId: user.id,
          actorId: userId,
          type: 'MENTION',
          content: `mentioned you in a post`,
          data: { postId: post.id },
        });
      }
    }

    // Update trending hashtags
    for (const tag of finalHashtags) {
      await this.redis.zincrby('trending:hashtags', 1, tag.toLowerCase());
      await this.redis.expire('trending:hashtags', 7 * 24 * 60 * 60); // 7 days
    }

    // Invalidate feed cache
    await this.redis.del(`feed:${userId}:*`);

    return post;
  }

  async getFeed(userId: string, query: PostQueryDto) {
    const { page = 1, limit = 20, sort = 'latest' } = query;
    const skip = (page - 1) * limit;

    // Get following users
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map(f => f.followingId);
    followingIds.push(userId);

    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'popular') {
      orderBy = { likesCount: 'desc' };
    } else if (sort === 'trending') {
      // Complex trending algorithm
      orderBy = [
        { likesCount: 'desc' },
        { commentsCount: 'desc' },
        { sharesCount: 'desc' },
        { createdAt: 'desc' },
      ];
    }

    const posts = await this.prisma.post.findMany({
      where: {
        userId: { in: followingIds },
        status: PostStatus.PUBLISHED,
        isPublic: true,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            shares: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy,
    });

    // Check if user liked each post
    const postsWithInteraction = await Promise.all(
      posts.map(async (post) => {
        const isLiked = await this.prisma.like.findUnique({
          where: {
            userId_postId: {
              userId,
              postId: post.id,
            },
          },
        });

        const isSaved = await this.prisma.savedPost.findUnique({
          where: {
            userId_postId: {
              userId,
              postId: post.id,
            },
          },
        });

        return {
          ...post,
          isLiked: !!isLiked,
          isSaved: !!isSaved,
        };
      }),
    );

    const total = await this.prisma.post.count({
      where: {
        userId: { in: followingIds },
        status: PostStatus.PUBLISHED,
      },
    });

    return {
      posts: postsWithInteraction,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTrendingPosts(limit: number = 20, timeframe: string = '24h') {
    const timeThreshold = new Date();
    if (timeframe === '24h') {
      timeThreshold.setHours(timeThreshold.getHours() - 24);
    } else if (timeframe === '7d') {
      timeThreshold.setDate(timeThreshold.getDate() - 7);
    } else if (timeframe === '30d') {
      timeThreshold.setDate(timeThreshold.getDate() - 30);
    }

    const posts = await this.prisma.post.findMany({
      where: {
        createdAt: { gte: timeThreshold },
        status: PostStatus.PUBLISHED,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            shares: true,
          },
        },
      },
      orderBy: [
        { likesCount: 'desc' },
        { commentsCount: 'desc' },
        { sharesCount: 'desc' },
      ],
      take: limit,
    });

    return posts;
  }

  async explorePosts(userId: string, query: PostQueryDto) {
    const { page = 1, limit = 20, search, hashtag } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      status: PostStatus.PUBLISHED,
      isPublic: true,
    };

    if (search) {
      where.content = { contains: search, mode: 'insensitive' };
    }

    if (hashtag) {
      where.hashtags = { has: hashtag };
    }

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
              shares: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      posts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
            shares: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.status !== PostStatus.PUBLISHED) {
      throw new ForbiddenException('This post is not available');
    }

    // Check if user can view this post
    if (!post.isPublic) {
      const isFollowing = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: post.userId,
          },
        },
      });

      if (!isFollowing && userId !== post.userId) {
        throw new ForbiddenException('You cannot view this post');
      }
    }

    // Increment views
    await this.prisma.post.update({
      where: { id: postId },
      data: { viewsCount: { increment: 1 } },
    });

    // Check interactions
    const [isLiked, isSaved] = await Promise.all([
      this.prisma.like.findUnique({
        where: {
          userId_postId: {
            userId,
            postId,
          },
        },
      }),
      this.prisma.savedPost.findUnique({
        where: {
          userId_postId: {
            userId,
            postId,
          },
        },
      }),
    ]);

    return {
      ...post,
      isLiked: !!isLiked,
      isSaved: !!isSaved,
    };
  }

  async updatePost(postId: string, userId: string, updatePostDto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.userId !== userId) {
      throw new ForbiddenException('You can only edit your own posts');
    }

    if (post.status === PostStatus.DELETED) {
      throw new BadRequestException('Cannot edit a deleted post');
    }

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: updatePostDto,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate cache
    await this.redis.del(`post:${postId}`);

    return updated;
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.userId !== userId) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    // Soft delete
    await this.prisma.post.update({
      where: { id: postId },
      data: { status: PostStatus.DELETED },
    });

    // Delete media files from S3
    if (post.mediaUrls.length > 0) {
      for (const url of post.mediaUrls) {
        await this.s3.deleteFile(url);
      }
    }

    // Invalidate cache
    await this.redis.del(`post:${postId}`);
    await this.redis.del(`user:${userId}:posts`);

    return { success: true };
  }

  async likePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Check if already liked
    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    if (existingLike) {
      throw new BadRequestException('Post already liked');
    }

    await this.prisma.like.create({
      data: {
        userId,
        postId,
      },
    });

    // Increment likes count
    await this.prisma.post.update({
      where: { id: postId },
      data: { likesCount: { increment: 1 } },
    });

    // Create notification
    if (userId !== post.userId) {
      await this.notificationsService.createNotification({
        userId: post.userId,
        actorId: userId,
        type: 'LIKE',
        content: 'liked your post',
        data: { postId },
      });
    }

    // Invalidate cache
    await this.redis.del(`post:${postId}`);

    return { success: true };
  }

  async unlikePost(postId: string, userId: string) {
    const like = await this.prisma.like.findUnique({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    if (!like) {
      throw new BadRequestException('Post not liked');
    }

    await this.prisma.like.delete({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });

    // Decrement likes count
    await this.prisma.post.update({
      where: { id: postId },
      data: { likesCount: { decrement: 1 } },
    });

    // Invalidate cache
    await this.redis.del(`post:${postId}`);

    return { success: true };
  }

  async sharePost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    await this.prisma.share.create({
      data: {
        userId,
        postId,
      },
    });

    // Increment shares count
    await this.prisma.post.update({
      where: { id: postId },
      data: { sharesCount: { increment: 1 } },
    });

    // Create notification
    if (userId !== post.userId) {
      await this.notificationsService.createNotification({
        userId: post.userId,
        actorId: userId,
        type: 'SHARE',
        content: 'shared your post',
        data: { postId },
      });
    }

    // Invalidate cache
    await this.redis.del(`post:${postId}`);

    return { success: true };
  }

  async pinPost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.userId !== userId) {
      throw new ForbiddenException('You can only pin your own posts');
    }

    // Unpin other posts
    await this.prisma.post.updateMany({
      where: {
        userId,
        isPinned: true,
      },
      data: { isPinned: false },
    });

    await this.prisma.post.update({
      where: { id: postId },
      data: { isPinned: true },
    });

    // Invalidate cache
    await this.redis.del(`user:${userId}:posts`);

    return { success: true };
  }

  async unpinPost(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.userId !== userId) {
      throw new ForbiddenException('You can only unpin your own posts');
    }

    await this.prisma.post.update({
      where: { id: postId },
      data: { isPinned: false },
    });

    // Invalidate cache
    await this.redis.del(`user:${userId}:posts`);

    return { success: true };
  }

  async getPostComments(postId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          postId,
          parentId: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          _count: {
            select: {
              likes: true,
              replies: true,
            },
          },
          replies: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
              _count: {
                select: {
                  likes: true,
                },
              },
            },
            take: 5,
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.comment.count({
        where: {
          postId,
          parentId: null,
        },
      }),
    ]);

    return {
      comments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserPosts(userId: string, currentUserId: string, query: PostQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    // Check privacy
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { privacyLevel: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.privacyLevel === PrivacyLevel.PRIVATE && userId !== currentUserId) {
      const isFollowing = await this.prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: userId,
          },
        },
      });

      if (!isFollowing) {
        throw new ForbiddenException('This user\'s posts are private');
      }
    }

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          userId,
          status: PostStatus.PUBLISHED,
        },
        include: {
          _count: {
            select: {
              likes: true,
              comments: true,
              shares: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: [
          { isPinned: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.post.count({
        where: {
          userId,
          status: PostStatus.PUBLISHED,
        },
      }),
    ]);

    // Check likes
    const postsWithInteraction = await Promise.all(
      posts.map(async (post) => {
        const isLiked = await this.prisma.like.findUnique({
          where: {
            userId_postId: {
              userId: currentUserId,
              postId: post.id,
            },
          },
        });

        return {
          ...post,
          isLiked: !!isLiked,
        };
      }),
    );

    return {
      posts: postsWithInteraction,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPostsByHashtag(tag: string, query: PostQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          hashtags: { has: tag },
          status: PostStatus.PUBLISHED,
          isPublic: true,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
              shares: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.post.count({
        where: {
          hashtags: { has: tag },
          status: PostStatus.PUBLISHED,
        },
      }),
    ]);

    return {
      posts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Admin methods
  async getReportedPosts(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          reports: {
            some: {
              status: 'PENDING',
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
          reports: {
            include: {
              reporter: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
              reports: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.post.count({
        where: {
          reports: {
            some: {
              status: 'PENDING',
            },
          },
        },
      }),
    ]);

    return {
      posts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updatePostStatus(postId: string, status: PostStatus, reason?: string) {
    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { status },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        userId: post.userId,
        action: 'UPDATE_POST_STATUS',
        entityType: 'Post',
        entityId: postId,
        changes: { status, reason },
      },
    });

    // If deleted, remove media files
    if (status === PostStatus.DELETED && post.mediaUrls.length > 0) {
      for (const url of post.mediaUrls) {
        await this.s3.deleteFile(url);
      }
    }

    // Invalidate cache
    await this.redis.del(`post:${postId}`);

    return { success: true };
  }
}
