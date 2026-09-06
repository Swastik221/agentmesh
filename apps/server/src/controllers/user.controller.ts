import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/user.service.js';
import { projectService } from '../services/project.service.js';
import { createUserSchema, updateUserSchema } from '../schemas/user.schema.js';

export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = createUserSchema.parse(req.body);
    const user = await userService.createUser(input);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    const user = await userService.getUserById(userId);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

export const getUserByWallet = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const walletAddress = req.params.walletAddress as string;
    const user = await userService.getUserByWallet(walletAddress);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(userId, input);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

export const getUserProjects = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    const projects = await projectService.getUserProjects(userId);
    res.status(200).json(projects);
  } catch (error) {
    next(error);
  }
};
